const VALID_SERVICE_LINES = new Set(["EVS", "CNS"]);
const HOSPITAL_TYPE_VALUES = new Set([
  "PRIMARY CARE",
  "SPECIALTY CARE",
  "ACUTE CARE",
  "OUTPATIENT",
  "INPATIENT",
  "AMBULATORY",
  "HOSPITAL",
  "HEALTH SYSTEM",
  "CLINIC",
  "MEDICAL CENTER"
]);

const DATA_PATHS = {
  summaryMetrics: "data/summary_metrics.json",
  leaderWorkloadSummary: "data/leader_workload_summary.json",
  leaderDrilldown: "data/leader_drilldown.json",
  newOpportunities: "data/new_opportunities.json",
  sensitivityResults: "data/sensitivity_results.json",
  networkNodesEdges: "data/network_nodes_edges.json",
  optimizedAssignments: "data/optimized_assignments.json",
  progressReports: "data/progress_reports.json"
};

let dashboardData = {
  summaryMetrics: {},
  leaderWorkloadSummary: [],
  leaderDrilldown: [],
  newOpportunities: [],
  sensitivityResults: [],
  networkNodesEdges: { nodes: [], edges: [] },
  optimizedAssignments: [],
  progressReports: []
};

function normalizeServiceLine(value) {
  if (value === null || value === undefined) return "";
  const cleaned = String(value).trim().toUpperCase();
  if (cleaned.includes("EVS") || cleaned.includes("ENVIRONMENTAL") || cleaned.includes("HOUSEKEEP")) return "EVS";
  if (cleaned.includes("CNS") || cleaned.includes("CULINARY") || cleaned.includes("NUTRITION") || cleaned.includes("FOOD")) return "CNS";
  if (VALID_SERVICE_LINES.has(cleaned)) return cleaned;
  if (HOSPITAL_TYPE_VALUES.has(cleaned)) return "";
  return "";
}

function formatNumber(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercent(value, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(decimals)}%`;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") return value.split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
  return [value];
}

function pick(obj, keys, fallback = undefined) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return fallback;
}

function numberPick(obj, keys, fallback = 0) {
  const value = pick(obj, keys, fallback);
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLeaderRecord(leader) {
  const serviceMix = leader["Service Mix"] || leader.service_mix || {};
  const serviceLinesFromMix = serviceMix && typeof serviceMix === "object" && !Array.isArray(serviceMix) ? Object.keys(serviceMix) : [];
  const serviceLines = toArray(
    pick(leader, ["service_lines", "serviceLine", "Service Lines", "Service Line", "service_line"], serviceLinesFromMix)
  ).map(normalizeServiceLine).filter(Boolean);

  return {
    ...leader,
    leader_name: pick(leader, ["leader_name", "Leader", "VP ID", "VP", "name"], "Unknown Leader"),
    region: pick(leader, ["region", "Region", "Market", "Division"], "--"),
    service_lines: [...new Set(serviceLines)],
    baseline_workload: numberPick(leader, ["baseline_workload", "Baseline Workload", "base Workload", "Base Workload"], 0),
    optimized_workload: numberPick(leader, ["optimized_workload", "Optimized Workload"], 0),
    capacity_status: pick(leader, ["capacity_status", "Capacity Status"], "Within Capacity"),
    facility_count: numberPick(leader, ["facility_count", "Facility Count", "Optimized Facility Count", "Current Facility Count"], 0),
    assigned_opportunities: toArray(pick(leader, ["assigned_opportunities", "Assigned Opportunities"], [])),
    review_flags: toArray(pick(leader, ["review_flags", "Review Flags"], []))
  };
}

function normalizeOpportunityRecord(opp) {
  return {
    ...opp,
    opportunity_name: pick(opp, ["opportunity_name", "Opportunity Name", "Facility ID", "entity", "name"], "Unnamed Opportunity"),
    recommended_vp: pick(opp, ["recommended_vp", "Recommended VP", "Assigned VP", "assigned_leader", "Assigned Leader"], "--"),
    service_line: normalizeServiceLine(pick(opp, ["service_line", "serviceLine", "Service Line"])),
    assignment_score: numberPick(opp, ["assignment_score", "Assignment Score", "Assignment Cost", "score"], 0)
  };
}

function getCapacityClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("over") || normalized.includes("risk")) return "risk";
  if (normalized.includes("near") || normalized.includes("watch")) return "warn";
  return "good";
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      console.warn(`Could not load ${path}. Status: ${response.status}`);
      return fallback;
    }
    return await response.json();
  } catch (error) {
    console.warn(`Unable to load ${path}`, error);
    return fallback;
  }
}

async function loadDashboardData() {
  dashboardData.summaryMetrics = await loadJson(DATA_PATHS.summaryMetrics, {});
  dashboardData.leaderWorkloadSummary = await loadJson(DATA_PATHS.leaderWorkloadSummary, []);
  dashboardData.leaderDrilldown = await loadJson(DATA_PATHS.leaderDrilldown, []);
  dashboardData.newOpportunities = await loadJson(DATA_PATHS.newOpportunities, []);
  dashboardData.sensitivityResults = await loadJson(DATA_PATHS.sensitivityResults, []);
  dashboardData.networkNodesEdges = await loadJson(DATA_PATHS.networkNodesEdges, { nodes: [], edges: [] });
  dashboardData.optimizedAssignments = await loadJson(DATA_PATHS.optimizedAssignments, []);
  dashboardData.progressReports = await loadJson(DATA_PATHS.progressReports, []);

  cleanDashboardData();
  updateDataStatus();
  renderAll();
}

function cleanDashboardData() {
  dashboardData.leaderWorkloadSummary = (dashboardData.leaderWorkloadSummary || []).map(normalizeLeaderRecord);

  dashboardData.leaderDrilldown = (dashboardData.leaderDrilldown || []).map(normalizeLeaderRecord);

  dashboardData.newOpportunities = (dashboardData.newOpportunities || [])
    .map(normalizeOpportunityRecord)
    .filter((opp) => !opp.service_line || VALID_SERVICE_LINES.has(opp.service_line));

  const nodes = toArray(dashboardData.networkNodesEdges.nodes).map((node) => {
    if ((node.type || node.group) === "service_line") {
      const normalizedLabel = normalizeServiceLine(node.label || node.id);
      return { ...node, label: normalizedLabel || node.label || node.id, type: "service_line" };
    }
    return node;
  }).filter((node) => {
    if ((node.type || node.group) !== "service_line") return true;
    return VALID_SERVICE_LINES.has(String(node.label || node.id));
  });

  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const edges = toArray(dashboardData.networkNodesEdges.edges).filter((edge) => {
    return nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target));
  });

  dashboardData.networkNodesEdges = { nodes, edges };
}

function updateDataStatus() {
  const status = document.getElementById("dataStatus");
  const loadedAny = dashboardData.leaderWorkloadSummary.length > 0 || dashboardData.newOpportunities.length > 0;
  if (!status) return;
  const source = dashboardData.summaryMetrics?.data_source || dashboardData.summaryMetrics?.source || "";
  const isSample = String(source).toLowerCase().includes("sample") || dashboardData.summaryMetrics?.is_sample_data === true;
  status.textContent = loadedAny ? (isSample ? "Sample data loaded - replace with notebook export" : "Model outputs loaded") : "Using empty data structure";
  status.className = loadedAny ? (isSample ? "status-pill warn" : "status-pill success") : "status-pill error";
}

function renderAll() {
  renderHome();
  renderCurrentState();
  renderScenarios();
  renderLeaderDrilldown();
  renderNetwork();
  renderProgressReports();
}

function renderHome() {
  const metrics = dashboardData.summaryMetrics || {};
  const leaders = dashboardData.leaderWorkloadSummary || [];
  const overCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "risk").length;
  const nearCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "warn").length;
  const metricsCapacityWatch =
    metrics.capacity_watch_count ??
    (Number(metrics.optimized_over_capacity_count || 0) + Number(metrics.optimized_near_capacity_count || 0));

  const cards = [
    {
      label: "Total Leaders",
      value: metrics.total_leaders ?? metrics.leader_count ?? leaders.length,
      note: "VPs included in model"
    },
    {
      label: "Facilities",
      value: metrics.total_facilities ?? metrics.current_facility_count ?? "--",
      note: "Current-state coverage"
    },
    {
      label: "New Opportunities",
      value: metrics.total_new_opportunities ?? metrics.new_opportunity_count ?? dashboardData.newOpportunities.length,
      note: "Opportunities to absorb"
    },
    {
      label: "Capacity Watch",
      value: Number.isFinite(Number(metricsCapacityWatch)) ? metricsCapacityWatch : overCapacity + nearCapacity,
      note: `${overCapacity} over capacity, ${nearCapacity} near capacity`
    }
  ];

  document.getElementById("summaryCards").innerHTML = cards.map(kpiCard).join("");
  document.getElementById("recommendationText").textContent = metrics.recommendation_summary || "Run the Python notebook, export the dashboard JSON files, and commit the data folder to populate the executive recommendation summary.";
}

function renderCurrentState() {
  const leaders = dashboardData.leaderWorkloadSummary || [];
  const overCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "risk").length;
  const nearCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "warn").length;
  const avgBaseline = leaders.length ? leaders.reduce((sum, leader) => sum + Number(leader.baseline_workload || 0), 0) / leaders.length : 0;
  const avgOptimized = leaders.length ? leaders.reduce((sum, leader) => sum + Number(leader.optimized_workload || 0), 0) / leaders.length : 0;

  document.getElementById("capacityCards").innerHTML = [
    { label: "Over Capacity", value: overCapacity, note: "Requires immediate review" },
    { label: "Near Capacity", value: nearCapacity, note: "Monitor before assigning more work" },
    { label: "Avg Baseline Workload", value: formatNumber(avgBaseline, 1), note: "Before optimization" },
    { label: "Avg Optimized Workload", value: formatNumber(avgOptimized, 1), note: "After scenario assignment" }
  ].map(kpiCard).join("");

  renderLeaderTable();
}

function renderLeaderTable() {
  const search = String(document.getElementById("leaderSearch")?.value || "").toLowerCase();
  const leaders = (dashboardData.leaderWorkloadSummary || []).filter((leader) => {
    const haystack = `${leader.leader_name || leader.name || ""} ${leader.region || ""}`.toLowerCase();
    return haystack.includes(search);
  });

  const rows = leaders.map((leader) => {
    const status = leader.capacity_status || "Within Capacity";
    const badgeClass = getCapacityClass(status);
    return `
      <tr>
        <td>${leader.leader_name || leader.name || "Unknown"}</td>
        <td>${leader.region || "--"}</td>
        <td>${(leader.service_lines || []).join(", ") || "--"}</td>
        <td>${formatNumber(leader.baseline_workload, 1)}</td>
        <td>${formatNumber(leader.optimized_workload, 1)}</td>
        <td><span class="badge ${badgeClass}">${status}</span></td>
        <td>${formatNumber(leader.facility_count)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("leaderTableBody").innerHTML = rows || `<tr><td colspan="7">No leader workload data found. Run the notebook export and commit data/leader_workload_summary.json.</td></tr>`;
}

function renderScenarios() {
  const scenarios = dashboardData.sensitivityResults || [];
  const select = document.getElementById("scenarioSelect");
  const currentValue = select.value;

  select.innerHTML = scenarios.map((scenario, index) => {
    const name = scenario.scenario_name || scenario.name || `Scenario ${index + 1}`;
    return `<option value="${name}">${name}</option>`;
  }).join("") || `<option value="baseline">Baseline</option>`;

  if (currentValue) select.value = currentValue;
  const selectedName = select.value;
  const selected = scenarios.find((scenario) => (scenario.scenario_name || scenario.name) === selectedName) || scenarios[0] || {};

  document.getElementById("scenarioCards").innerHTML = [
    { label: "Scenario Score", value: formatNumber(selected.total_score ?? selected.score, 1), note: "Composite assignment score" },
    { label: "Capacity Improvement", value: formatPercent(selected.capacity_improvement_pct ?? selected.capacity_improvement, 1), note: "Compared with baseline" },
    { label: "Reassignments", value: selected.reassignment_count ?? selected.reassignments ?? "--", note: "Implementation disruption" },
    { label: "Stability", value: selected.stability_rating || "--", note: "Sensitivity confidence" }
  ].map(kpiCard).join("");

  renderSensitivityChart();
  renderOpportunityTable();
}

function renderSensitivityChart() {
  const scenarios = dashboardData.sensitivityResults || [];
  const maxScore = Math.max(...scenarios.map((item) => Number(item.total_score ?? item.score ?? 0)), 1);
  const html = scenarios.map((item, index) => {
    const label = item.scenario_name || item.name || `Scenario ${index + 1}`;
    const score = Number(item.total_score ?? item.score ?? 0);
    const width = Math.max(2, (score / maxScore) * 100);
    return `
      <div class="bar-row">
        <span class="bar-label">${label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
        <span class="bar-value">${formatNumber(score, 1)}</span>
      </div>
    `;
  }).join("");

  document.getElementById("sensitivityChart").innerHTML = html || `<p class="empty-state">No sensitivity results found. Export data/sensitivity_results.json from the Python notebook.</p>`;
}

function renderOpportunityTable() {
  const rows = (dashboardData.newOpportunities || []).map((opp) => `
    <tr>
      <td>${opp.opportunity_name || opp.name || "Unnamed Opportunity"}</td>
      <td>${opp.recommended_vp || opp.assigned_leader || "--"}</td>
      <td>${opp.service_line || "--"}</td>
      <td>${formatNumber(opp.assignment_score ?? opp.score, 1)}</td>
    </tr>
  `).join("");

  document.getElementById("opportunityTableBody").innerHTML = rows || `<tr><td colspan="4">No new opportunity assignments found.</td></tr>`;
}

function renderLeaderDrilldown() {
  const leaders = dashboardData.leaderDrilldown.length ? dashboardData.leaderDrilldown : dashboardData.leaderWorkloadSummary;
  const select = document.getElementById("leaderSelect");
  const currentValue = select.value;

  select.innerHTML = leaders.map((leader, index) => {
    const name = leader.leader_name || leader.name || `Leader ${index + 1}`;
    return `<option value="${name}">${name}</option>`;
  }).join("");

  if (currentValue) select.value = currentValue;
  const selectedName = select.value;
  const leader = leaders.find((item) => (item.leader_name || item.name) === selectedName) || leaders[0];

  if (!leader) {
    document.getElementById("leaderDetail").innerHTML = `<p class="empty-state">No leader drill-down data found. Export data/leader_drilldown.json from the Python notebook.</p>`;
    return;
  }

  const opportunities = toArray(leader.assigned_opportunities).map((opp) => `<li>${opp}</li>`).join("") || `<li>No new opportunities assigned in selected output.</li>`;
  const flags = toArray(leader.review_flags).map((flag) => `<li>${flag}</li>`).join("") || `<li>No review flags listed.</li>`;

  document.getElementById("leaderDetail").innerHTML = `
    <article class="detail-card">
      <h3>${leader.leader_name || leader.name}</h3>
      <p>${leader.region || "Region not specified"}</p>
      <span class="badge ${getCapacityClass(leader.capacity_status)}">${leader.capacity_status || "Within Capacity"}</span>
    </article>
    <article class="detail-card">
      <h4>Workload and Portfolio Impact</h4>
      <div class="metric-list">
        <div class="metric-line"><span>Baseline Workload</span><strong>${formatNumber(leader.baseline_workload, 1)}</strong></div>
        <div class="metric-line"><span>Optimized Workload</span><strong>${formatNumber(leader.optimized_workload, 1)}</strong></div>
        <div class="metric-line"><span>Facilities</span><strong>${formatNumber(leader.facility_count)}</strong></div>
        <div class="metric-line"><span>Service Lines</span><strong>${(leader.service_lines || []).join(", ") || "--"}</strong></div>
      </div>
      <h4>Assigned Opportunities</h4>
      <ul>${opportunities}</ul>
      <h4>Review Flags</h4>
      <ul>${flags}</ul>
    </article>
  `;
}

function renderNetwork() {
  const filter = document.getElementById("networkFilter").value;
  const nodes = dashboardData.networkNodesEdges.nodes || [];
  const edges = dashboardData.networkNodesEdges.edges || [];
  const visibleNodes = filter === "all" ? nodes : nodes.filter((node) => (node.type || node.group) === filter);
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));

  const legendItems = [
    ["leader", "Leaders"],
    ["facility", "Facilities"],
    ["opportunity", "Opportunities"],
    ["service_line", "Service Lines: EVS/CNS"]
  ];

  document.getElementById("networkLegend").innerHTML = legendItems.map(([type, label]) => `<span class="badge">${label}</span>`).join("");

  const html = visibleNodes.map((node) => {
    const relationships = edges.filter((edge) => String(edge.source) === String(node.id) || String(edge.target) === String(node.id));
    const relationshipText = relationships.map((edge) => {
      const otherId = String(edge.source) === String(node.id) ? edge.target : edge.source;
      const other = nodeMap.get(String(otherId));
      return other ? other.label || other.name || other.id : otherId;
    }).slice(0, 8).join(", ");

    return `
      <article class="network-item">
        <strong>${node.label || node.name || node.id}</strong>
        <p>${node.type || node.group || "node"} ${relationshipText ? `connected to ${relationshipText}` : "with no relationships listed"}</p>
      </article>
    `;
  }).join("");

  document.getElementById("networkList").innerHTML = html || `<p class="empty-state">No network data found. Export data/network_nodes_edges.json from the Python notebook.</p>`;
}

function renderProgressReports() {
  const reports = dashboardData.progressReports.length ? dashboardData.progressReports : [
    {
      title: "Current Focus",
      body: "Connect the dashboard to model-exported JSON files and remove hardcoded mock data from the JavaScript layer.",
      items: ["Python notebook is source of truth", "GitHub Pages reads data files", "Service lines restricted to EVS and CNS"]
    },
    {
      title: "Implementation Decision",
      body: "GitHub Pages is static, so Python model results must be exported as JSON or CSV before deployment.",
      items: ["Run notebook", "Commit data/ folder", "Dashboard fetches model outputs"]
    },
    {
      title: "Next Step",
      body: "Replace sample data with production model exports and validate executive summary metrics.",
      items: ["Review data quality", "Confirm weighting assumptions", "Validate assignment recommendations"]
    }
  ];

  document.getElementById("progressReports").innerHTML = reports.map((report) => `
    <article class="progress-card">
      <h3>${report.title}</h3>
      <p>${report.body || ""}</p>
      <ul>${toArray(report.items).map((item) => `<li>${item}</li>`).join("")}</ul>
    </article>
  `).join("");
}

function kpiCard(card) {
  return `
    <article class="kpi-card">
      <p>${card.label}</p>
      <h3>${card.value}</h3>
      <span>${card.note || ""}</span>
    </article>
  `;
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });
}

function setupControls() {
  document.getElementById("leaderSearch")?.addEventListener("input", renderLeaderTable);
  document.getElementById("scenarioSelect")?.addEventListener("change", renderScenarios);
  document.getElementById("leaderSelect")?.addEventListener("change", renderLeaderDrilldown);
  document.getElementById("networkFilter")?.addEventListener("change", renderNetwork);
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupControls();
  loadDashboardData();
});
