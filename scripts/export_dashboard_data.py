"""
Strategic Growth Planning dashboard export script.

Purpose
-------
Run this after your Python / Colab model has produced model DataFrames.
It writes dashboard-ready JSON files into ../data so GitHub Pages can read them.

Expected source CSVs, if running standalone from repo root:
- inputs/facilities.csv
- inputs/new_opportunities.csv
- inputs/vp_master.csv
- outputs/optimized_assignments.csv, optional
- outputs/sensitivity_results.csv, optional

You can also copy the helper functions into your notebook and call
export_dashboard_data(...) directly with your in-memory DataFrames.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
INPUT_DIR = ROOT / "inputs"
OUTPUT_DIR = ROOT / "outputs"

VALID_SERVICE_LINES = {"EVS", "CNS"}
SERVICE_LINE_ALIASES = {
    "EVS": "EVS",
    "ENVIRONMENTAL SERVICES": "EVS",
    "ENVIRONMENTAL SERVICE": "EVS",
    "HOUSEKEEPING": "EVS",
    "JANITORIAL": "EVS",
    "CNS": "CNS",
    "CULINARY": "CNS",
    "CULINARY SERVICES": "CNS",
    "NUTRITION": "CNS",
    "NUTRITION SERVICES": "CNS",
    "FOOD SERVICE": "CNS",
    "FOOD SERVICES": "CNS",
    "DINING": "CNS",
}
HOSPITAL_TYPE_VALUES = {
    "PRIMARY CARE",
    "SPECIALTY CARE",
    "ACUTE CARE",
    "OUTPATIENT",
    "INPATIENT",
    "AMBULATORY",
    "HOSPITAL",
    "HEALTH SYSTEM",
    "CLINIC",
    "MEDICAL CENTER",
}


def normalize_service_line(value: Any) -> str | None:
    """Return EVS/CNS or None. Hospital-type labels are excluded."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    cleaned = str(value).strip().upper()
    if cleaned in SERVICE_LINE_ALIASES:
        return SERVICE_LINE_ALIASES[cleaned]
    if "EVS" in cleaned or "ENVIRONMENTAL" in cleaned or "HOUSEKEEP" in cleaned:
        return "EVS"
    if "CNS" in cleaned or "CULINARY" in cleaned or "NUTRITION" in cleaned or "FOOD" in cleaned:
        return "CNS"
    if cleaned in HOSPITAL_TYPE_VALUES:
        return None
    return None


def first_existing_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    normalized = {col.strip().lower(): col for col in df.columns}
    for candidate in candidates:
        if candidate.strip().lower() in normalized:
            return normalized[candidate.strip().lower()]
    return None


def value_or_default(row: pd.Series, columns: list[str], default: Any = None) -> Any:
    for col in columns:
        if col in row.index and pd.notna(row[col]):
            return row[col]
    return default


def clean_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert NaN/inf values so JSON is browser-safe."""
    cleaned_records: list[dict[str, Any]] = []
    for record in records:
        cleaned: dict[str, Any] = {}
        for key, value in record.items():
            if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
                cleaned[key] = None
            elif isinstance(value, pd.Timestamp):
                cleaned[key] = value.isoformat()
            else:
                cleaned[key] = value
        cleaned_records.append(cleaned)
    return cleaned_records


def write_json(filename: str, payload: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / filename
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=False, allow_nan=False)
    print(f"Wrote {path.relative_to(ROOT)}")


def build_leader_summary(facilities: pd.DataFrame) -> pd.DataFrame:
    """Create leader workload summary from facility-level data."""
    vp_col = first_existing_column(facilities, ["VP", "VP Name", "Leader", "leader_name", "vp_name"])
    region_col = first_existing_column(facilities, ["Region", "Market", "Division"])
    service_col = first_existing_column(facilities, ["Service Line", "service_line", "Service"])
    baseline_col = first_existing_column(facilities, ["Baseline Workload", "baseline_workload", "Workload", "workload"])
    optimized_col = first_existing_column(facilities, ["Optimized Workload", "optimized_workload"])
    facility_col = first_existing_column(facilities, ["Facility", "Facility Name", "facility_name", "Account"])

    if vp_col is None:
        raise ValueError("Could not find a VP/Leader column in facilities data.")

    working = facilities.copy()
    working["leader_name"] = working[vp_col].fillna("Unknown Leader").astype(str)
    working["region"] = working[region_col].fillna("Not specified").astype(str) if region_col else "Not specified"
    working["service_line_clean"] = working[service_col].apply(normalize_service_line) if service_col else None
    working["baseline_workload_value"] = pd.to_numeric(working[baseline_col], errors="coerce").fillna(1.0) if baseline_col else 1.0
    working["optimized_workload_value"] = pd.to_numeric(working[optimized_col], errors="coerce") if optimized_col else working["baseline_workload_value"]
    working["facility_key"] = working[facility_col].fillna("Unknown Facility") if facility_col else working.index.astype(str)

    grouped = working.groupby("leader_name", dropna=False).agg(
        region=("region", lambda values: values.mode().iat[0] if not values.mode().empty else "Not specified"),
        service_lines=("service_line_clean", lambda values: sorted({v for v in values if v in VALID_SERVICE_LINES})),
        baseline_workload=("baseline_workload_value", "sum"),
        optimized_workload=("optimized_workload_value", "sum"),
        facility_count=("facility_key", "nunique"),
    ).reset_index()

    grouped["capacity_status"] = grouped["optimized_workload"].apply(capacity_status)
    return grouped


def capacity_status(workload: float) -> str:
    if workload >= 100:
        return "Over Capacity"
    if workload >= 85:
        return "Near Capacity"
    if workload <= 65:
        return "Available Capacity"
    return "Within Capacity"


def build_new_opportunities(opportunities: pd.DataFrame, optimized_assignments: pd.DataFrame | None = None) -> pd.DataFrame:
    name_col = first_existing_column(opportunities, ["Opportunity", "Opportunity Name", "opportunity_name", "name"])
    service_col = first_existing_column(opportunities, ["Service Line", "service_line", "Service"])
    vp_col = first_existing_column(opportunities, ["Recommended VP", "Assigned VP", "assigned_leader", "VP", "Leader"])
    score_col = first_existing_column(opportunities, ["Assignment Score", "assignment_score", "Score", "score"])

    records = []
    for idx, row in opportunities.iterrows():
        service_line = normalize_service_line(row[service_col]) if service_col else None
        if service_line is None and service_col:
            continue
        records.append({
            "opportunity_name": value_or_default(row, [name_col] if name_col else [], f"Opportunity {idx + 1}"),
            "recommended_vp": value_or_default(row, [vp_col] if vp_col else [], "Unassigned"),
            "service_line": service_line,
            "assignment_score": float(pd.to_numeric(value_or_default(row, [score_col] if score_col else [], 0), errors="coerce") or 0),
        })

    result = pd.DataFrame(records)

    if optimized_assignments is not None and not optimized_assignments.empty:
        assignment_name_col = first_existing_column(optimized_assignments, ["Opportunity", "Opportunity Name", "opportunity_name", "entity"])
        assignment_vp_col = first_existing_column(optimized_assignments, ["Assigned VP", "Recommended VP", "assigned_leader", "VP", "Leader"])
        if assignment_name_col and assignment_vp_col and not result.empty:
            lookup = optimized_assignments[[assignment_name_col, assignment_vp_col]].rename(
                columns={assignment_name_col: "opportunity_name", assignment_vp_col: "recommended_vp_from_model"}
            )
            result = result.merge(lookup, on="opportunity_name", how="left")
            result["recommended_vp"] = result["recommended_vp_from_model"].fillna(result["recommended_vp"])
            result = result.drop(columns=["recommended_vp_from_model"])

    return result


def build_network_nodes_edges(facilities: pd.DataFrame, opportunities: pd.DataFrame, leader_summary: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    def add_node(node_id: str, label: str, node_type: str) -> None:
        if node_id and node_id not in nodes:
            nodes[node_id] = {"id": node_id, "label": label, "type": node_type}

    for service_line in sorted(VALID_SERVICE_LINES):
        add_node(service_line, service_line, "service_line")

    for _, row in leader_summary.iterrows():
        leader = str(row["leader_name"])
        add_node(leader, leader, "leader")
        for service_line in row.get("service_lines", []):
            if service_line in VALID_SERVICE_LINES:
                edges.append({"source": leader, "target": service_line, "relationship": "service_line_fit"})

    vp_col = first_existing_column(facilities, ["VP", "VP Name", "Leader", "leader_name", "vp_name"])
    facility_col = first_existing_column(facilities, ["Facility", "Facility Name", "facility_name", "Account"])
    service_col = first_existing_column(facilities, ["Service Line", "service_line", "Service"])

    if vp_col and facility_col:
        for _, row in facilities.iterrows():
            leader = str(row[vp_col]) if pd.notna(row[vp_col]) else None
            facility = str(row[facility_col]) if pd.notna(row[facility_col]) else None
            if not leader or not facility:
                continue
            add_node(leader, leader, "leader")
            add_node(facility, facility, "facility")
            edges.append({"source": leader, "target": facility, "relationship": "current_assignment"})
            if service_col:
                service_line = normalize_service_line(row[service_col])
                if service_line:
                    edges.append({"source": facility, "target": service_line, "relationship": "service_line"})

    opp_name_col = first_existing_column(opportunities, ["Opportunity", "Opportunity Name", "opportunity_name", "name"])
    opp_vp_col = first_existing_column(opportunities, ["Recommended VP", "Assigned VP", "assigned_leader", "VP", "Leader"])
    opp_service_col = first_existing_column(opportunities, ["Service Line", "service_line", "Service"])

    if opp_name_col:
        for _, row in opportunities.iterrows():
            opportunity = str(row[opp_name_col]) if pd.notna(row[opp_name_col]) else None
            if not opportunity:
                continue
            add_node(opportunity, opportunity, "opportunity")
            if opp_vp_col and pd.notna(row[opp_vp_col]):
                leader = str(row[opp_vp_col])
                add_node(leader, leader, "leader")
                edges.append({"source": leader, "target": opportunity, "relationship": "recommended_assignment"})
            if opp_service_col:
                service_line = normalize_service_line(row[opp_service_col])
                if service_line:
                    edges.append({"source": opportunity, "target": service_line, "relationship": "service_line"})

    return {"nodes": list(nodes.values()), "edges": edges}


def build_summary_metrics(leader_summary: pd.DataFrame, facilities: pd.DataFrame, opportunities: pd.DataFrame) -> dict[str, Any]:
    over_capacity = int((leader_summary["capacity_status"] == "Over Capacity").sum()) if not leader_summary.empty else 0
    near_capacity = int((leader_summary["capacity_status"] == "Near Capacity").sum()) if not leader_summary.empty else 0
    return {
        "total_leaders": int(len(leader_summary)),
        "total_facilities": int(len(facilities)),
        "total_new_opportunities": int(len(opportunities)),
        "capacity_watch_count": over_capacity + near_capacity,
        "recommendation_summary": (
            "Review the optimized assignment scenario against baseline capacity, geography, EVS/CNS service-line fit, "
            "and disruption tradeoffs before final leadership approval."
        ),
    }


def build_leader_drilldown(leader_summary: pd.DataFrame, opportunities: pd.DataFrame) -> pd.DataFrame:
    opp_vp_col = first_existing_column(opportunities, ["Recommended VP", "Assigned VP", "assigned_leader", "VP", "Leader"])
    opp_name_col = first_existing_column(opportunities, ["Opportunity", "Opportunity Name", "opportunity_name", "name"])

    assignments: dict[str, list[str]] = {}
    if opp_vp_col and opp_name_col:
        for _, row in opportunities.iterrows():
            if pd.isna(row[opp_vp_col]) or pd.isna(row[opp_name_col]):
                continue
            assignments.setdefault(str(row[opp_vp_col]), []).append(str(row[opp_name_col]))

    records = []
    for _, row in leader_summary.iterrows():
        leader = str(row["leader_name"])
        flags: list[str] = []
        if row["capacity_status"] == "Over Capacity":
            flags.append("Over capacity after optimization")
        elif row["capacity_status"] == "Near Capacity":
            flags.append("Near capacity; monitor future additions")
        if not row.get("service_lines"):
            flags.append("No valid EVS/CNS service-line alignment identified")
        records.append({
            **row.to_dict(),
            "assigned_opportunities": assignments.get(leader, []),
            "review_flags": flags,
        })
    return pd.DataFrame(records)


def export_dashboard_data(
    facilities: pd.DataFrame,
    opportunities: pd.DataFrame,
    optimized_assignments: pd.DataFrame | None = None,
    sensitivity_results: pd.DataFrame | None = None,
) -> None:
    leader_summary = build_leader_summary(facilities)
    new_opportunities = build_new_opportunities(opportunities, optimized_assignments)
    leader_drilldown = build_leader_drilldown(leader_summary, opportunities)
    network = build_network_nodes_edges(facilities, opportunities, leader_summary)
    summary_metrics = build_summary_metrics(leader_summary, facilities, opportunities)

    if sensitivity_results is None or sensitivity_results.empty:
        sensitivity_results = pd.DataFrame([
            {"scenario_name": "Balanced Growth", "total_score": 0, "capacity_improvement_pct": 0, "reassignment_count": 0, "stability_rating": "Pending"}
        ])

    write_json("summary_metrics.json", summary_metrics)
    write_json("leader_workload_summary.json", clean_records(leader_summary.to_dict(orient="records")))
    write_json("leader_drilldown.json", clean_records(leader_drilldown.to_dict(orient="records")))
    write_json("new_opportunities.json", clean_records(new_opportunities.to_dict(orient="records")))
    write_json("sensitivity_results.json", clean_records(sensitivity_results.to_dict(orient="records")))
    write_json("network_nodes_edges.json", network)
    write_json("optimized_assignments.json", clean_records((optimized_assignments if optimized_assignments is not None else pd.DataFrame()).to_dict(orient="records")))

    progress_reports = [
        {
            "title": "Latest Export",
            "body": "Dashboard data was generated from the Python model export script.",
            "items": ["Service lines normalized to EVS/CNS", "Hospital-type labels excluded", "JSON files written to data/"],
        }
    ]
    write_json("progress_reports.json", progress_reports)


def read_optional_csv(path: Path) -> pd.DataFrame | None:
    return pd.read_csv(path) if path.exists() else None


def main() -> None:
    facilities_path = INPUT_DIR / "facilities.csv"
    opportunities_path = INPUT_DIR / "new_opportunities.csv"

    if not facilities_path.exists() or not opportunities_path.exists():
        raise FileNotFoundError(
            "Missing input files. Add inputs/facilities.csv and inputs/new_opportunities.csv, "
            "or call export_dashboard_data(...) from your notebook with DataFrames."
        )

    facilities = pd.read_csv(facilities_path)
    opportunities = pd.read_csv(opportunities_path)
    optimized_assignments = read_optional_csv(OUTPUT_DIR / "optimized_assignments.csv")
    sensitivity_results = read_optional_csv(OUTPUT_DIR / "sensitivity_results.csv")

    export_dashboard_data(facilities, opportunities, optimized_assignments, sensitivity_results)


if __name__ == "__main__":
    main()
