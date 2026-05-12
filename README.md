# Strategic Growth Planning VP Assignment Dashboard

This repository contains a static GitHub Pages dashboard and a Python export script for the Strategic Growth Planning VP assignment optimization project.

## What this repo does

The dashboard compares the organization's current operational structure against model-generated optimized assignments that consider workload capacity, geographic alignment, EVS/CNS service-line fit, and implementation disruption.

The architecture is intentionally split into two layers:

1. **Python / Colab model layer**
   - Loads facility and opportunity data
   - Cleans and validates inputs
   - Normalizes service lines to EVS and CNS
   - Calculates workload and capacity metrics
   - Runs assignment and optimization logic
   - Exports dashboard-ready JSON files

2. **GitHub Pages dashboard layer**
   - Uses `index.html`, `style.css`, and `app.js`
   - Reads JSON files from the `data/` folder
   - Renders executive summaries, current-state views, scenario comparisons, leader drill-downs, network relationships, and progress reports

## Important service-line rule

Service lines are limited to:

- **EVS**: Environmental Services / housekeeping
- **CNS**: Culinary and nutrition services

Hospital-type labels such as Primary Care, Acute Care, Outpatient, Inpatient, Specialty Care, Clinic, or Medical Center are not treated as service lines and are excluded from the Network service-line view.

## Repository structure

```text
index.html
style.css
app.js
README.md
requirements.txt
scripts/
  export_dashboard_data.py
data/
  summary_metrics.json
  leader_workload_summary.json
  leader_drilldown.json
  new_opportunities.json
  sensitivity_results.json
  network_nodes_edges.json
  optimized_assignments.json
  progress_reports.json
```

## GitHub Pages setup

1. Create a new GitHub repository.
2. Upload all files from this folder to the root of the repo.
3. Go to **Settings > Pages**.
4. Set source to **Deploy from a branch**.
5. Select **main** branch and **root** folder.
6. Save.

## How to update dashboard data from the model

### Option A: Use this script from the repo

Create these input files:

```text
inputs/facilities.csv
inputs/new_opportunities.csv
```

Optional model output files:

```text
outputs/optimized_assignments.csv
outputs/sensitivity_results.csv
```

Install dependencies and run:

```bash
pip install -r requirements.txt
python scripts/export_dashboard_data.py
```

Commit the updated `data/` folder to GitHub.

### Option B: Use the export functions inside your Colab notebook

Copy `scripts/export_dashboard_data.py` into your Colab notebook or import it, then call:

```python
export_dashboard_data(
    facilities=facilities,
    opportunities=new_opportunities,
    optimized_assignments=optimized_assignments,
    sensitivity_results=sensitivity_results,
)
```

Then download the generated `data/` folder and upload it into the GitHub repo.

## Data files the dashboard expects

The dashboard fetches these files directly from the repo:

```text
data/summary_metrics.json
data/leader_workload_summary.json
data/leader_drilldown.json
data/new_opportunities.json
data/sensitivity_results.json
data/network_nodes_edges.json
data/optimized_assignments.json
data/progress_reports.json
```

If a file is missing, the dashboard will still load, but that section will show an empty-state message.

## Local testing

Because the dashboard uses `fetch()`, open it through a local server instead of double-clicking `index.html`.

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```
