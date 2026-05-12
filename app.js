// ============================================================
// SGP VP Assignment Dashboard
// Frontend display layer for GitHub Pages
// Reads model outputs from /data JSON files
// ============================================================

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

// ============================================================
// Utility helpers
// ============================================================

function getEl(id) {
  return document.getElementById(id);
}

function setHtml(id, html) {
  const el = getEl(id);
  if (el) el.innerHTML = html;
}

function setText(id, text) {
  const el = getEl(id);
  if (el) el.textContent = text;
}

function pick(obj, keys, fallback = undefined) {
  if (!obj) return fallback;

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }

  return fallback;
}

function numberPick(obj, keys, fallback = 0) {
  const value = pick(obj, keys, fallback);
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];

  if (typeof value === "string") {
    return value
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [value];
}

function formatNumber(value, decimals = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "--";

  return number.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercent(value, decimals = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) return "--";

  return `${number.toFixed(decimals)}%`;
}

function normalizeServiceLine(value) {
  if (value === null || value === undefined) return "";

  const cleaned = String(value).trim().toUpperCase();

  if (cleaned === "EVS") return "EVS";
  if (cleaned === "CNS") return "CNS";

  if (
    cleaned.includes("ENVIRONMENTAL") ||
    cleaned.includes("HOUSEKEEP") ||
    cleaned.includes("JANITORIAL")
  ) {
    return "EVS";
  }

  if (
    cleaned.includes("CULINARY") ||
    cleaned.includes("NUTRITION") ||
    cleaned.includes("FOOD") ||
    cleaned.includes("DINING")
  ) {
    return "CNS";
  }

  if (HOSPITAL_TYPE_VALUES.has(cleaned)) return "";

  return "";
}

function getCapacityClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (
    normalized.includes("over") ||
    normalized.includes("risk") ||
    normalized.includes("exceed")
  ) {
    return "risk";
  }

  if (
    normalized.includes("near") ||
    normalized.includes("watch") ||
    normalized.includes("monitor")
  ) {
    return "warn";
  }

  return "good";
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

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}">${message}</td></tr>`;
}

function emptyState(message) {
  return `<p class="empty-state">${message}</p>`;
}

// ============================================================
// Scenario helpers
// These fix the notebook-to-dashboard field mismatch.
// Notebook exports scenario_name, candidate_score,
// optimized_score, and violations.
// ============================================================

function getScenarioName(scenario) {
  return pick(
    scenario,
    ["scenario_name", "scenarioName", "scenario_label", "scenarioLabel", "name"],
    "Unnamed Scenario"
  );
}

function getCandidateScore(scenario) {
  return numberPick(
    scenario,
    ["candidate_score", "candidateScore", "baseline_score", "baselineScore", "total_candidate_score"],
    0
  );
}

function getOptimizedScore(scenario) {
  return numberPick(
    scenario,
    ["optimized_score", "optimizedScore", "total_score", "score"],
    0
  );
}

function getScenarioViolations(scenario) {
  return numberPick(
    scenario,
    ["violations", "capacity_violations", "capacityViolations", "constraint_violations", "reassignment_count"],
    0
  );
}

function getScenarioImprovementPct(scenario) {
  const directValue = pick(
    scenario,
    ["capacity_improvement_pct", "capacity_improvement", "percent_improvement"],
    null
  );

  if (directValue !== null && directValue !== undefined) {
    const directNumber = Number(directValue);
    if (Number.isFinite(directNumber)) return directNumber;
  }

  const candidate = getCandidateScore(scenario);
  const optimized = getOptimizedScore(scenario);

  if (!candidate || !Number.isFinite(candidate) || !Number.isFinite(optimized)) {
    return 0;
  }

  return ((candidate - optimized) / candidate) * 100;
}

function getScenarioStabilityRating(scenario) {
  const directValue = pick(scenario, ["stability_rating", "stability"], null);

  if (directValue) return directValue;

  const violations = getScenarioViolations(scenario);

  if (violations <= 10) return "High";
  if (violations <= 30) return "Medium";
  return "Needs Review";
}

// ============================================================
// Data loading
// ============================================================

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

  normalizeLoadedData();
  updateDataStatus();
  renderAll();
}

function normalizeLoadedData() {
  dashboardData.leaderWorkloadSummary = toArray(dashboardData.leaderWorkloadSummary).map(normalizeLeaderRecord);
  dashboardData.leaderDrilldown = toArray(dashboardData.leaderDrilldown).map(normalizeLeaderRecord);
  dashboardData.newOpportunities = toArray(dashboardData.newOpportunities).map(normalizeOpportunityRecord);
  dashboardData.sensitivityResults = toArray(dashboardData.sensitivityResults);

  normalizeNetworkData();
}

function normalizeLeaderRecord(leader) {
  const serviceMix = pick(leader, ["Service Mix", "service_mix"], {});
  let serviceLineSource = pick(
    leader,
    ["service_lines", "serviceLine", "Service Lines", "Service Line", "service_line"],
    []
  );

  if (
    (!serviceLineSource || toArray(serviceLineSource).length === 0) &&
    serviceMix &&
    typeof serviceMix === "object" &&
    !Array.isArray(serviceMix)
  ) {
    serviceLineSource = Object.keys(serviceMix);
  }

  const serviceLines = [...new Set(
    toArray(serviceLineSource)
      .map(normalizeServiceLine)
      .filter(Boolean)
  )];

  return {
    ...leader,
    leader_name: pick(
      leader,
      ["leader_name", "Leader", "VP Name", "VP ID", "VP", "name"],
      "Unknown Leader"
    ),
    region: pick(
      leader,
      ["region", "Region", "Market", "Division"],
      "--"
    ),
    service_lines: serviceLines,
    baseline_workload: numberPick(
      leader,
      ["baseline_workload", "Baseline Workload", "Base Workload", "Current Workload"],
      0
    ),
    optimized_workload: numberPick(
      leader,
      ["optimized_workload", "Optimized Workload", "Final Workload"],
      0
    ),
    capacity_status: pick(
      leader,
      ["capacity_status", "Capacity Status", "status"],
      "Within Capacity"
    ),
    facility_count: numberPick(
      leader,
      ["facility_count", "Facility Count", "Optimized Facility Count", "Current Facility Count"],
      0
    ),
    assigned_opportunities: toArray(
      pick(leader, ["assigned_opportunities", "Assigned Opportunities"], [])
    ),
    review_flags: toArray(
      pick(leader, ["review_flags", "Review Flags"], [])
    )
  };
}

function normalizeOpportunityRecord(opp) {
  const serviceLine = normalizeServiceLine(
    pick(opp, ["service_line", "serviceLine", "Service Line"], "")
  );

  return {
    ...opp,
    opportunity_name: pick(
      opp,
      ["opportunity_name", "Opportunity Name", "Facility ID", "entity", "name"],
      "Unnamed Opportunity"
    ),
    recommended_vp: pick(
      opp,
      ["recommended_vp", "Recommended VP", "Assigned VP", "assigned_leader", "Assigned Leader"],
      "--"
    ),
    service_line: serviceLine,
    assignment_score: numberPick(
      opp,
      ["assignment_score", "Assignment Score", "Assignment Cost", "score"],
      0
    )
  };
}

function normalizeNetworkData() {
  const rawNetwork = dashboardData.networkNodesEdges || { nodes: [], edges: [] };
  const rawNodes = toArray(rawNetwork.nodes);
  const rawEdges = toArray(rawNetwork.edges);

  const nodes = rawNodes
    .map((node) => {
      const rawType = pick(node, ["type", "group"], "");
      let type = rawType;

      if (type === "current") type = "facility";

      if (type === "service_line") {
        const label = normalizeServiceLine(pick(node, ["label", "name", "id"], ""));

        if (!label || !VALID_SERVICE_LINES.has(label)) {
          return null;
        }

        return {
          ...node,
          type,
          label
        };
      }

      return {
        ...node,
        type
      };
    })
    .filter(Boolean);

  const nodeIds = new Set(nodes.map((node) => String(node.id)));

  const edges = rawEdges.filter((edge) => {
    return nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target));
  });

  dashboardData.networkNodesEdges = { nodes, edges };
}

// ============================================================
// Rendering
// ============================================================

function updateDataStatus() {
  const statusEl = getEl("dataStatus");

  if (!statusEl) return;

  const loadedAny =
    dashboardData.leaderWorkloadSummary.length > 0 ||
    dashboardData.newOpportunities.length > 0 ||
    dashboardData.sensitivityResults.length > 0;

  const source = dashboardData.summaryMetrics?.data_source || dashboardData.summaryMetrics?.source || "";
  const isSample =
    String(source).toLowerCase().includes("sample") ||
    dashboardData.summaryMetrics?.is_sample_data === true;

  if (!loadedAny) {
    statusEl.textContent = "Using empty data structure";
    statusEl.className = "status-pill error";
    return;
  }

  if (isSample) {
    statusEl.textContent = "Sample data loaded - replace with notebook export";
    statusEl.className = "status-pill warn";
    return;
  }

  statusEl.textContent = "Model outputs loaded";
  statusEl.className = "status-pill success";
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
  const opportunities = dashboardData.newOpportunities || [];

  const overCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "risk").length;
  const nearCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "warn").length;

  const capacityWatch =
    metrics.capacity_watch_count ??
    metrics.capacityWatch ??
    Number(metrics.optimized_over_capacity_count || 0) + Number(metrics.optimized_near_capacity_count || 0) ||
    overCapacity + nearCapacity;

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
      value: metrics.total_new_opportunities ?? metrics.new_opportunity_count ?? opportunities.length,
      note: "Opportunities to absorb"
    },
    {
      label: "Capacity Watch",
      value: capacityWatch,
      note: `${overCapacity} over capacity, ${nearCapacity} near capacity`
    }
  ];

  setHtml("summaryCards", cards.map(kpiCard).join(""));

  const recommendation =
    metrics.recommendation_summary ||
    metrics.recommendation ||
    "Run the Python notebook, export the dashboard JSON files, and commit the data folder to populate the executive recommendation summary.";

  setText("recommendationText", recommendation);
}

function renderCurrentState() {
  const leaders = dashboardData.leaderWorkloadSummary || [];

  const overCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "risk").length;
  const nearCapacity = leaders.filter((leader) => getCapacityClass(leader.capacity_status) === "warn").length;

  const avgBaseline = leaders.length
    ? leaders.reduce((sum, leader) => sum + Number(leader.baseline_workload || 0), 0) / leaders.length
    : 0;

  const avgOptimized = leaders.length
    ? leaders.reduce((sum, leader) => sum + Number(leader.optimized_workload || 0), 0) / leaders.length
    : 0;

  const cards = [
    {
      label: "Over Capacity",
      value: overCapacity,
      note: "Requires immediate review"
    },
    {
      label: "Near Capacity",
      value: nearCapacity,
      note: "Monitor before assigning more work"
    },
    {
      label: "Avg Baseline Workload",
      value: formatNumber(avgBaseline, 1),
      note: "Before optimization"
    },
    {
      label: "Avg Optimized Workload",
      value: formatNumber(avgOptimized, 1),
      note: "After scenario assignment"
    }
  ];

  setHtml("capacityCards", cards.map(kpiCard).join(""));
  renderLeaderTable();
}

function renderLeaderTable() {
  const tableBody = getEl("leaderTableBody");

  if (!tableBody) return;

  const search = String(getEl("leaderSearch")?.value || "").toLowerCase();

  const leaders = (dashboardData.leaderWorkloadSummary || []).filter((leader) => {
    const haystack = `${leader.leader_name || ""} ${leader.region || ""}`.toLowerCase();
    return haystack.includes(search);
  });

  if (!leaders.length) {
    tableBody.innerHTML = emptyRow(
      7,
      "No leader workload data found. Run the notebook export and commit data/leader_workload_summary.json."
    );
    return;
  }

  tableBody.innerHTML = leaders
    .map((leader) => {
      const status = leader.capacity_status || "Within Capacity";
      const badgeClass = getCapacityClass(status);

      return `
        <tr>
          <td>${leader.leader_name || "Unknown"}</td>
          <td>${leader.region || "--"}</td>
          <td>${(leader.service_lines || []).join(", ") || "--"}</td>
          <td>${formatNumber(leader.baseline_workload, 1)}</td>
          <td>${formatNumber(leader.optimized_workload, 1)}</td>
          <td><span class="badge ${badgeClass}">${status}</span></td>
          <td>${formatNumber(leader.facility_count)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderScenarios() {
  const scenarios = dashboardData.sensitivityResults || [];
  const scenarioSelect = getEl("scenarioSelect");
  const scenarioCards = getEl("scenarioCards");

  if (!scenarioSelect || !scenarioCards) return;

  if (!scenarios.length) {
    scenarioCards.innerHTML = `
      <article class="kpi-card">
        <p>No Scenario Data</p>
        <h3>--</h3>
        <span>Check data/sensitivity_results.json</span>
      </article>
    `;

    setHtml("sensitivityChart", emptyState("No sensitivity results found."));
    return;
  }

  const previousValue = scenarioSelect.value;

  scenarioSelect.innerHTML = scenarios
    .map((scenario) => {
      const name = getScenarioName(scenario);
      return `<option value="${name}">${name}</option>`;
    })
    .join("");

  if (previousValue && scenarios.some((scenario) => getScenarioName(scenario) === previousValue)) {
    scenarioSelect.value = previousValue;
  }

  const selectedName = scenarioSelect.value || getScenarioName(scenarios[0]);

  const selectedScenario =
    scenarios.find((scenario) => getScenarioName(scenario) === selectedName) ||
    scenarios[0];

  const candidateScore = getCandidateScore(selectedScenario);
  const optimizedScore = getOptimizedScore(selectedScenario);
  const improvementPct = getScenarioImprovementPct(selectedScenario);
  const violations = getScenarioViolations(selectedScenario);
  const stability = getScenarioStabilityRating(selectedScenario);

  const cards = [
    {
      label: "Candidate Score",
      value: formatNumber(candidateScore, 1),
      note: "Before optimization"
    },
    {
      label: "Optimized Score",
      value: formatNumber(optimizedScore, 1),
      note: "After optimization"
    },
    {
      label: "Improvement",
      value: formatPercent(improvementPct, 1),
      note: "Candidate to optimized"
    },
    {
      label: "Capacity Violations",
      value: formatNumber(violations),
      note: `Stability: ${stability}`
    }
  ];

  scenarioCards.innerHTML = cards.map(kpiCard).join("");

  renderSensitivityChart();
  renderOpportunityTable();
}

function renderSensitivityChart() {
  const chart = getEl("sensitivityChart");
  if (!chart) return;

  const scenarios = dashboardData.sensitivityResults || [];

  if (!scenarios.length) {
    chart.innerHTML = emptyState("No sensitivity results found.");
    return;
  }

  const scores = scenarios.map(getOptimizedScore).filter(Number.isFinite);
  const maxScore = Math.max(...scores, 1);

  chart.innerHTML = scenarios
    .map((scenario) => {
      const name = getScenarioName(scenario);
      const optimizedScore = getOptimizedScore(scenario);
      const width = Math.max(2, (optimizedScore / maxScore) * 100);

      return `
        <div class="bar-row">
          <span class="bar-label">${name}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:${width}%"></span>
          </span>
          <span class="bar-value">${formatNumber(optimizedScore, 1)}</span>
        </div>
      `;
    })
    .join("");
}

function renderOpportunityTable() {
  const tableBody = getEl("opportunityTableBody");
  if (!tableBody) return;

  const opportunities = dashboardData.newOpportunities || [];

  if (!opportunities.length) {
    tableBody.innerHTML = emptyRow(4, "No new opportunity assignments found.");
    return;
  }

  tableBody.innerHTML = opportunities
    .map((opp) => {
      return `
        <tr>
          <td>${opp.opportunity_name || "Unnamed Opportunity"}</td>
          <td>${opp.recommended_vp || "--"}</td>
          <td>${opp.service_line || "--"}</td>
          <td>${formatNumber(opp.assignment_score, 1)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderLeaderDrilldown() {
  const leaders = dashboardData.leaderDrilldown.length
    ? dashboardData.leaderDrilldown
    : dashboardData.leaderWorkloadSummary;

  const leaderSelect = getEl("leaderSelect");
  const detail = getEl("leaderDetail");

  if (!leaderSelect || !detail) return;

  if (!leaders.length) {
    detail.innerHTML = emptyState(
      "No leader drill-down data found. Export data/leader_drilldown.json from the Python notebook."
    );
    return;
  }

  const previousValue = leaderSelect.value;

  leaderSelect.innerHTML = leaders
    .map((leader) => {
      const name = leader.leader_name || "Unknown Leader";
      return `<option value="${name}">${name}</option>`;
    })
    .join("");

  if (previousValue && leaders.some((leader) => leader.leader_name === previousValue)) {
    leaderSelect.value = previousValue;
  }

  const selectedName = leaderSelect.value || leaders[0].leader_name;

  const leader =
    leaders.find((item) => item.leader_name === selectedName) ||
    leaders[0];

  const opportunities = toArray(leader.assigned_opportunities)
    .map(displayOpportunityItem)
    .filter(Boolean);

  const flags = toArray(leader.review_flags);

  detail.innerHTML = `
    <article class="detail-card">
      <h3>${leader.leader_name || "Unknown Leader"}</h3>
      <p>${leader.region || "Region not specified"}</p>
      <span class="badge ${getCapacityClass(leader.capacity_status)}">
        ${leader.capacity_status || "Within Capacity"}
      </span>
    </article>

    <article class="detail-card">
      <h4>Workload and Portfolio Impact</h4>

      <div class="metric-list">
        <div class="metric-line">
          <span>Baseline Workload</span>
          <strong>${formatNumber(leader.baseline_workload, 1)}</strong>
        </div>

        <div class="metric-line">
          <span>Optimized Workload</span>
          <strong>${formatNumber(leader.optimized_workload, 1)}</strong>
        </div>

        <div class="metric-line">
          <span>Facilities</span>
          <strong>${formatNumber(leader.facility_count)}</strong>
        </div>

        <div class="metric-line">
          <span>Service Lines</span>
          <strong>${(leader.service_lines || []).join(", ") || "--"}</strong>
        </div>
      </div>

      <h4>Assigned Opportunities</h4>
      <ul>
        ${
          opportunities.length
            ? opportunities.map((opp) => `<li>${opp}</li>`).join("")
            : "<li>No new opportunities assigned in selected output.</li>"
        }
      </ul>

      <h4>Review Flags</h4>
      <ul>
        ${
          flags.length
            ? flags.map((flag) => `<li>${flag}</li>`).join("")
            : "<li>No review flags listed.</li>"
        }
      </ul>
    </article>
  `;
}

function displayOpportunityItem(opp) {
  if (opp === null || opp === undefined) return "";
  if (typeof opp === "string") return opp;

  return pick(
    opp,
    ["opportunity_name", "Opportunity Name", "Facility ID", "entity", "name"],
    JSON.stringify(opp)
  );
}

function renderNetwork() {
  const networkList = getEl("networkList");
  if (!networkList) return;

  const filter = getEl("networkFilter")?.value || "all";

  const nodes = dashboardData.networkNodesEdges.nodes || [];
  const edges = dashboardData.networkNodesEdges.edges || [];

  const visibleNodes =
    filter === "all"
      ? nodes
      : nodes.filter((node) => (node.type || node.group) === filter);

  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));

  setHtml(
    "networkLegend",
    `
      <span class="badge">Leaders</span>
      <span class="badge">Facilities</span>
      <span class="badge">Opportunities</span>
      <span class="badge">Service Lines: EVS/CNS</span>
    `
  );

  if (!visibleNodes.length) {
    networkList.innerHTML = emptyState(
      "No network data found. Export data/network_nodes_edges.json from the Python notebook."
    );
    return;
  }

  networkList.innerHTML = visibleNodes
    .map((node) => {
      const relationships = edges.filter((edge) => {
        return String(edge.source) === String(node.id) || String(edge.target) === String(node.id);
      });

      const relationshipText = relationships
        .map((edge) => {
          const otherId = String(edge.source) === String(node.id) ? edge.target : edge.source;
          const otherNode = nodeMap.get(String(otherId));
          return otherNode ? otherNode.label || otherNode.name || otherNode.id : otherId;
        })
        .slice(0, 8)
        .join(", ");

      return `
        <article class="network-item">
          <strong>${node.label || node.name || node.id}</strong>
          <p>
            ${node.type || node.group || "node"}
            ${relationshipText ? `connected to ${relationshipText}` : "with no relationships listed"}
          </p>
        </article>
      `;
    })
    .join("");
}

function renderProgressReports() {
  const container = getEl("progressReports");
  if (!container) return;

  const fallbackReports = [
    {
      title: "Current Focus",
      body: "Connect the dashboard to model-exported JSON files and remove hardcoded mock data from the JavaScript layer.",
      items: [
        "Python notebook is source of truth",
        "GitHub Pages reads data files",
        "Service lines restricted to EVS and CNS"
      ]
    },
    {
      title: "Implementation Decision",
      body: "GitHub Pages is static, so Python model results must be exported as JSON or CSV before deployment.",
      items: [
        "Run notebook",
        "Commit data/ folder",
        "Dashboard fetches model outputs"
      ]
    },
    {
      title: "Next Step",
      body: "Replace sample data with production model exports and validate executive summary metrics.",
      items: [
        "Review data quality",
        "Confirm weighting assumptions",
        "Validate assignment recommendations"
      ]
    }
  ];

  const reports = dashboardData.progressReports.length
    ? dashboardData.progressReports
    : fallbackReports;

  container.innerHTML = reports
    .map((report) => {
      return `
        <article class="progress-card">
          <h3>${report.title}</h3>
          <p>${report.body || ""}</p>
          <ul>
            ${toArray(report.items).map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </article>
      `;
    })
    .join("");
}

// ============================================================
// UI setup
// ============================================================

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((item) => {
        item.classList.remove("active");
      });

      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.remove("active");
      });

      button.classList.add("active");

      const tabId = button.dataset.tab;
      const tabPanel = getEl(tabId);

      if (tabPanel) {
        tabPanel.classList.add("active");
      }
    });
  });
}

function setupControls() {
  getEl("leaderSearch")?.addEventListener("input", renderLeaderTable);
  getEl("scenarioSelect")?.addEventListener("change", renderScenarios);
  getEl("leaderSelect")?.addEventListener("change", renderLeaderDrilldown);
  getEl("networkFilter")?.addEventListener("change", renderNetwork);
}

// ============================================================
// Start
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupControls();
  loadDashboardData();
});
