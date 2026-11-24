(function () {
  "use strict";

  const auth = window.CampusCareAuth;
  const PAGE_TITLES = {
    landing: "CampusCare — A better campus starts with listening",
    login: "Sign in — CampusCare",
    register: "Create an account — CampusCare",
    "student-dashboard": "Student dashboard — CampusCare",
    "submit-complaint": "Submit a complaint — CampusCare",
    "my-complaints": "My complaints — CampusCare",
    "complaint-details": "Complaint details — CampusCare",
    "admin-dashboard": "Admin dashboard — CampusCare",
    "admin-complaints": "Complaint management — CampusCare",
    "admin-complaint-details": "Manage complaint — CampusCare"
  };
  const STUDENT_PAGES = ["student-dashboard", "submit-complaint", "my-complaints", "complaint-details"];
  const ADMIN_PAGES = ["admin-dashboard", "admin-complaints", "admin-complaint-details"];
  const COMPLAINT_CATEGORIES = ["Facilities", "IT & Wi-Fi", "Academics", "Cleanliness", "Safety", "Other"];
  const COMPLAINT_LOCATIONS = ["Central Library", "Main Block", "Hostel", "Cafeteria", "Engineering Lab", "Sports Complex", "Other"];
  const COMPLAINT_PRIORITIES = ["Low", "Medium", "High"];
  const COMPLAINT_STATUSES = ["Pending", "In Progress", "Resolved"];
  const ADMIN_PAGE_LINKS = [
    ["admin-dashboard.html", "Overview", "admin-dashboard"],
    ["admin-complaints.html", "Complaint management", "admin-complaints"]
  ];
  const app = document.getElementById("app");

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
    });
  }

  function normalizeComplaint(item) {
    const complaintId = item.complaintId || item.id || "";
    return {
      ...item,
      id: complaintId,
      ownerId: item.studentId || item.ownerId || "",
      ownerName: item.studentName || item.ownerName || "",
      ownerEmail: item.studentEmail || item.ownerEmail || "",
      adminRemark: item.adminRemark || ""
    };
  }

  function homeFor(user) {
    return user && user.role === "admin" ? "admin-dashboard.html" : "student-dashboard.html";
  }

  function dateText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function dateTimeText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  }

  function statusClass(status) {
    return status === "In Progress" ? "in-progress" : status.toLowerCase();
  }

  function statusBadge(status) {
    return `<span class="badge badge-${statusClass(status)}">${escapeHtml(status)}</span>`;
  }

  function priorityBadge(priority) {
    return `<span class="badge badge-priority-${escapeHtml(priority.toLowerCase())}">${escapeHtml(priority)} priority</span>`;
  }

  function complaintHref(id, admin) {
    const page = admin ? "admin-complaint-details.html" : "complaint-details.html";
    return `${page}?id=${encodeURIComponent(id)}`;
  }

  function header(user, active, isLanding) {
    const brand = `<a class="brand" href="index.html" aria-label="CampusCare home"><span class="brand-mark" aria-hidden="true">C</span><span>Campus<em>Care</em></span></a>`;
    let links = "";
    if (user && user.role === "student") {
      links = [
        ["student-dashboard.html", "Dashboard", "student-dashboard"],
        ["submit-complaint.html", "Submit complaint", "submit-complaint"],
        ["my-complaints.html", "My complaints", "my-complaints"]
      ].map((item) => `<a class="nav-link" href="${item[0]}"${active === item[2] ? ' aria-current="page"' : ""}>${item[1]}</a>`).join("");
    } else if (user && user.role === "admin") {
      links = [
        ["admin-dashboard.html", "Overview", "admin-dashboard"],
        ["admin-complaints.html", "Manage complaints", "admin-complaints"]
      ].map((item) => `<a class="nav-link" href="${item[0]}"${active === item[2] ? ' aria-current="page"' : ""}>${item[1]}</a>`).join("");
    } else if (isLanding) {
      links = `<a class="nav-link" href="student-login.html">Sign in</a><a class="button button-small" href="student-register.html">Create account</a>`;
    } else {
      links = `<a class="nav-link" href="index.html">Home</a><a class="nav-link" href="student-login.html">Sign in</a>`;
    }
    const account = user
      ? `<span class="nav-user"><span>${escapeHtml(user.name)}</span><button class="button button-secondary button-small" type="button" data-action="logout">Sign out</button></span>`
      : "";
    return `<header class="site-header"><div class="header-inner">${brand}<nav class="main-nav" aria-label="Main navigation">${links}${account}</nav></div></header>`;
  }

  function shell(content, user, page) {
    const footerNote = ADMIN_PAGES.includes(page)
      ? "Administrator actions are verified by the backend"
      : "Complaint records are loaded from the backend";
    const adminNavigation = ADMIN_PAGES.includes(page)
      ? `<aside class="admin-sidebar" aria-label="Administrator navigation"><p class="eyebrow">Workspace</p><nav>${ADMIN_PAGE_LINKS.map((item) => `<a href="${item[0]}"${page === item[2] ? ' aria-current="page"' : ""}>${item[1]}</a>`).join("")}</nav><p class="admin-sidebar-note">Changes are checked by CampusCare’s backend.</p></aside>`
      : "";
    const layout = ADMIN_PAGES.includes(page)
      ? `<div class="admin-layout">${adminNavigation}<section class="admin-content">${content}</section></div>`
      : content;
    return `${header(user, page, page === "landing")}<main class="page-main"><div class="container">${layout}</div></main><footer class="site-footer"><div class="container footer-inner"><span>CampusCare · A more connected campus</span><span>${footerNote}</span></div></footer><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
  }

  function pageHeading(eyebrow, title, description, action) {
    return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${action || ""}</div>`;
  }

  function statCard(label, value, icon) {
    return `<article class="stat-card"><div class="stat-top"><span>${escapeHtml(label)}</span><span class="stat-icon" aria-hidden="true">${icon}</span></div><strong class="stat-value">${value}</strong></article>`;
  }

  function statusChart(counts, total) {
    return `<div class="status-chart" role="img" aria-label="Complaint status breakdown: ${counts.Pending} pending, ${counts["In Progress"]} in progress, ${counts.Resolved} resolved">
      ${COMPLAINT_STATUSES.map((status) => {
        const value = counts[status] || 0;
        const width = total ? Math.max(value ? 4 : 0, Math.round(value / total * 100)) : 0;
        return `<div class="chart-row"><span>${escapeHtml(status)}</span><div class="chart-track"><div class="chart-fill ${statusClass(status)}" style="width:${width}%"></div></div><strong>${value}</strong></div>`;
      }).join("")}
    </div>`;
  }

  function complaintCard(item, admin) {
    return `<article class="complaint-card">
      <div><h3>${escapeHtml(item.title)}</h3><div class="complaint-meta"><span class="complaint-id">${escapeHtml(item.id)}</span><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.location)}</span><span>${dateText(item.createdAt)}</span></div></div>
      <div class="complaint-card-actions">${statusBadge(item.status)}<a class="button button-secondary button-small" href="${complaintHref(item.id, admin)}">View details</a></div>
    </article>`;
  }

  function emptyState(title, text, action) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}${action ? `<br>${action}` : ""}</div>`;
  }

  function landingPage(user, message) {
    const action = user
      ? `<a class="button" href="${homeFor(user)}">Go to my dashboard</a>`
      : `<a class="button" href="student-register.html">Get started <span aria-hidden="true">→</span></a><a class="button button-secondary" href="student-login.html">Sign in</a>`;
    return `${header(user, "landing", true)}
      ${message ? `<div class="container"><p class="auth-alert" role="alert">${escapeHtml(message)}</p></div>` : ""}
      <main>
        <section class="hero"><div class="container hero-content"><div><p class="eyebrow">Campus life, improved together</p><h1>A better campus starts with listening.</h1><p class="hero-copy">Share a concern, follow its progress, and help your campus team focus on what matters. CampusCare keeps every update in one clear place.</p><div class="hero-actions">${action}</div></div>
        <aside class="hero-card" aria-label="How CampusCare works"><h2>Small steps. Meaningful change.</h2><div class="hero-step"><span class="step-number">1</span><span><strong>Tell us what needs attention</strong><span>Choose a category and campus location.</span></span></div><div class="hero-step"><span class="step-number">2</span><span><strong>Follow your request</strong><span>See updates from submission to resolution.</span></span></div><div class="hero-step"><span class="step-number">3</span><span><strong>Make campus better</strong><span>Clear feedback helps teams take action.</span></span></div></aside></div></section>
        <section class="landing-section"><div class="container"><p class="eyebrow">One connected campus</p><h2>Feedback that moves forward.</h2><p>CampusCare gives students and administrators a shared, simple view of campus concerns and their progress.</p><div class="feature-grid"><article class="feature-card"><span class="feature-icon" aria-hidden="true">✎</span><h3>Easy to raise</h3><p>Submit a clear complaint with its location, priority, and supporting details.</p></article><article class="feature-card"><span class="feature-icon" aria-hidden="true">◷</span><h3>Simple to follow</h3><p>Check complaint status, important dates, and administrator remarks at any time.</p></article><article class="feature-card"><span class="feature-icon" aria-hidden="true">↗</span><h3>Built for action</h3><p>Give campus teams an organized queue to review, prioritize, and resolve issues.</p></article></div></div></section>
      </main>
      <footer class="site-footer"><div class="container footer-inner"><span>CampusCare · A more connected campus</span><span>Complaint records are available after secure sign-in</span></div></footer>`;
  }

  function loginPage(message) {
    return `<div class="auth-wrap"><section class="auth-card" aria-labelledby="auth-title"><p class="eyebrow">Welcome back</p><h1 id="auth-title">Sign in to CampusCare</h1><p>Continue to your secure Amazon Cognito sign-in page.</p>
      <div class="form"><p class="form-error" id="login-error" role="alert">${escapeHtml(message || "")}</p><button class="button" type="button" data-action="cognito-login">Continue to sign in</button></div>
      <div class="demo-note"><strong>Secure sign-in</strong>Your password is entered on Cognito’s HTTPS page. CampusCare does not store it. Administrator access is assigned separately by campus staff.</div><p class="auth-switch">New to CampusCare? <a href="student-register.html">Create a student account</a></p></section></div>`;
  }

  function registerPage(message) {
    return `<div class="auth-wrap"><section class="auth-card" aria-labelledby="auth-title"><p class="eyebrow">Join your campus community</p><h1 id="auth-title">Create your student account</h1><p>Cognito securely handles registration and sign-in. New accounts are students; administrators are assigned by campus staff.</p>
      <div class="form"><p class="form-error" id="register-error" role="alert">${escapeHtml(message || "")}</p><button class="button" type="button" data-action="cognito-signup">Continue to student registration</button></div>
      <p class="demo-note">Registration requires self-sign-up to be enabled in the Cognito pool. Do not enable paid email or SMS delivery without reviewing its cost.</p><p class="auth-switch">Already registered? <a href="student-login.html">Sign in</a></p></section></div>`;
  }

  function studentDashboard(user) {
    const action = `<a class="button" href="submit-complaint.html">＋ Submit a complaint</a>`;
    return `${pageHeading("Student space", `Welcome, ${user.name.split(" ")[0]}`, "Here’s the latest on the concerns you’ve shared with your campus team.", action)}
      <p class="auth-alert" id="student-dashboard-error" role="alert" hidden></p>
      <section class="stats-grid" aria-label="Your complaint totals">${statCard("Total complaints", '<span id="student-total">—</span>', "▤")}${statCard("Pending", '<span id="student-pending">—</span>', "◷")}${statCard("In progress", '<span id="student-in-progress">—</span>', "↻")}${statCard("Resolved", '<span id="student-resolved">—</span>', "✓")}</section>
      <div class="dashboard-grid"><section class="panel"><div class="section-heading"><h2 class="section-title">Recent complaints</h2><a class="nav-link" href="my-complaints.html">View all →</a></div><div id="student-dashboard-recent" aria-live="polite"><p class="muted">Loading your complaints…</p></div></section>
      <aside class="panel"><h2 class="section-title">Status at a glance</h2><p class="muted small">A quick view of your complaint progress.</p><div id="student-status-chart">${statusChart({ Pending: 0, "In Progress": 0, Resolved: 0 }, 0)}</div><a class="button button-secondary button-small" href="my-complaints.html" style="margin-top:22px">Open complaint history</a></aside></div>`;
  }

  function submitPage() {
    const options = (values) => values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    return `${pageHeading("Student space", "Submit a complaint", "Share enough detail for the right campus team to understand and respond.")}
      <section class="panel"><form class="form" id="complaint-form" novalidate>
        <div class="field"><label for="complaint-title">Complaint title</label><input id="complaint-title" name="title" required minlength="3" maxlength="100" placeholder="A short summary of the issue"><span class="field-hint">Use a clear title between 3 and 100 characters.</span></div>
        <div class="form-grid"><div class="field"><label for="complaint-category">Category</label><select id="complaint-category" name="category" required><option value="">Select a category</option>${options(COMPLAINT_CATEGORIES)}</select></div><div class="field"><label for="complaint-location">Campus location</label><select id="complaint-location" name="location" required><option value="">Select a location</option>${options(COMPLAINT_LOCATIONS)}</select></div></div>
        <div class="field"><span class="field-label">Priority</span><div class="priority-options" role="radiogroup" aria-label="Complaint priority"><label class="priority-option"><input type="radio" name="priority" value="Low" required><span>Low</span></label><label class="priority-option"><input type="radio" name="priority" value="Medium"><span>Medium</span></label><label class="priority-option"><input type="radio" name="priority" value="High"><span>High</span></label></div><span class="field-hint">Choose how urgently the issue needs attention.</span></div>
        <div class="field"><label for="complaint-description">Description</label><textarea id="complaint-description" name="description" required minlength="20" maxlength="2000" placeholder="Describe what happened, where it happened, and any useful context."></textarea><span class="field-hint">Please provide at least 20 characters and no more than 2,000.</span></div>
        <div class="admin-warning"><strong>Image attachments are not available yet.</strong> Complaint images need a secure backend storage and retrieval feature; this version does not upload them.</div>
        <p class="form-error" id="complaint-error" role="alert"></p><div class="form-actions"><a class="button button-secondary" href="student-dashboard.html">Cancel</a><button class="button" type="submit">Submit complaint</button></div>
      </form></section>`;
  }

  function studentComplaints() {
    return `${pageHeading("Student space", "My complaints", "Review your live submissions and open an item to see its latest status and history.", `<a class="button" href="submit-complaint.html">＋ Submit a complaint</a>`)}
      <section class="panel"><div id="student-complaints-region" aria-live="polite"><p class="muted">Loading your complaints…</p></div><div id="student-complaints-pagination"></div></section>`;
  }

  function timeline(item, adminMode) {
    const history = Array.isArray(item.history) ? item.history : [];
    if (!history.length) return emptyState("No status history yet", "Updates will appear here.");
    return `<div class="timeline">${history.map((event) => `<div class="timeline-item is-complete"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-copy"><strong>${escapeHtml(event.status)}</strong><span>${dateTimeText(event.at)} · ${escapeHtml(event.note || "Status updated")}${adminMode && event.adminId ? ` · Updated by ${escapeHtml(event.adminId)}` : ""}</span></div></div>`).join("")}</div>`;
  }

  function complaintDetailsContent(source, adminMode) {
    const item = normalizeComplaint(source);
    const backLink = adminMode ? "admin-complaints.html" : "my-complaints.html";
    const ownerInfo = adminMode ? `<div class="detail-item"><dt>Submitted by</dt><dd>${escapeHtml(item.ownerName)}<br><span class="muted small">${escapeHtml(item.ownerEmail)}</span></dd></div>` : "";
    const nextStatuses = item.status === "Pending"
      ? ["Pending", "In Progress"]
      : item.status === "In Progress"
        ? ["In Progress", "Resolved"]
        : [item.status];
    const managementPanel = adminMode ? `<section class="panel"><h2 class="section-title">Update complaint</h2><p class="muted small">The backend checks this transition and records the administrator and timestamp.</p><form class="management-form" id="manage-form" data-id="${escapeHtml(item.id)}"><div class="field"><label for="manage-status">Status</label><select id="manage-status" name="status" required>${nextStatuses.map((status) => `<option value="${escapeHtml(status)}"${item.status === status ? " selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select><span class="field-hint">Move complaints in order: Pending → In Progress → Resolved.</span></div><div class="field"><label for="manage-remark">Administrator remarks</label><textarea id="manage-remark" name="remark" maxlength="1000" placeholder="Add an update the student can see">${escapeHtml(item.adminRemark)}</textarea><span class="field-hint" id="manage-remark-hint">Remarks cannot be cleared once saved. A resolution requires a remark.</span></div><p class="form-error" id="manage-error" role="alert"></p><button class="button" type="submit">Save updates</button></form></section>` : "";
    const image = `<div class="secure-image-placeholder"><strong>Secure image viewing is not enabled</strong><p class="muted small">The current backend does not store or serve complaint images. No browser-local or unverified image is shown here.</p></div>`;
    const details = `<section class="panel"><div class="detail-title"><div><span class="complaint-id">${escapeHtml(item.id)}</span><h2>${escapeHtml(item.title)}</h2><div class="complaint-meta"><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.location)}</span></div></div><div>${statusBadge(item.status)}</div></div>
      <dl class="detail-grid">${ownerInfo}<div class="detail-item"><dt>Priority</dt><dd>${priorityBadge(item.priority)}</dd></div><div class="detail-item"><dt>Submitted</dt><dd>${dateTimeText(item.createdAt)}</dd></div><div class="detail-item"><dt>Last updated</dt><dd>${dateTimeText(item.updatedAt)}</dd></div></dl>
      <div class="detail-item"><dt>Description</dt><dd><p class="description">${escapeHtml(item.description)}</p></dd></div><div class="detail-item" style="margin-top:22px"><dt>Uploaded image</dt><dd>${image}</dd></div></section>
      <aside><section class="panel"><h2 class="section-title">Status timeline</h2>${timeline(item, adminMode)}</section><section class="panel"><h2 class="section-title">Administrator remarks</h2>${item.adminRemark ? `<div class="remark-box" style="margin-top:14px">${escapeHtml(item.adminRemark)}</div>` : `<p class="muted small" style="margin:14px 0 0">No administrator remarks yet. Check back for updates.</p>`}</section>${managementPanel}</aside>`;
    return `<div class="page-heading"><div><p class="eyebrow">${adminMode ? "Complaint management" : "Student space"}</p><h1>Complaint details</h1><p>Review the submission and the latest progress from your campus team.</p></div><a class="button button-secondary" href="${backLink}">← Back to ${adminMode ? "management" : "my complaints"}</a></div><div class="detail-layout">${details}</div>`;
  }

  function adminDashboard() {
    return `${pageHeading("Administration", "Campus overview", "A live snapshot of complaints from the CampusCare backend.", `<a class="button" href="admin-complaints.html">Manage complaints →</a>`)}
      <p class="auth-alert" id="admin-dashboard-error" role="alert" hidden></p>
      <section class="stats-grid" aria-label="Campus complaint totals">${statCard("Total complaints", '<span id="admin-total">—</span>', "▤")}${statCard("Pending", '<span id="admin-pending">—</span>', "◷")}${statCard("In progress", '<span id="admin-in-progress">—</span>', "↻")}${statCard("Resolved", '<span id="admin-resolved">—</span>', "✓")}</section>
      <div class="dashboard-grid"><section class="panel"><div class="section-heading"><h2 class="section-title">Recent complaints</h2><a class="nav-link" href="admin-complaints.html">Open management →</a></div><div id="admin-recent" aria-live="polite"><p class="muted">Loading recent complaints…</p></div></section>
      <aside><section class="panel"><h2 class="section-title">Category breakdown</h2><p class="muted small">Complaints by campus topic.</p><div id="admin-categories"><p class="muted">Loading categories…</p></div></section><section class="panel"><h2 class="section-title">Status distribution</h2><div id="admin-status-chart">${statusChart({ Pending: 0, "In Progress": 0, Resolved: 0 }, 0)}</div></section></aside></div>`;
  }

  const studentListState = { page: 0, pageTokens: [null], nextToken: null, requestId: 0, pageSize: 20 };
  const adminListState = { query: "", category: "", priority: "", status: "", page: 0, pageTokens: [null], nextToken: null, requestId: 0, pageSize: 20 };

  function adminFilters() {
    const selectOptions = (values) => values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    return `<div class="toolbar" role="search"><label class="visually-hidden" for="filter-search">Search complaint titles</label><input id="filter-search" type="search" placeholder="Search complaint titles" autocomplete="off">
      <label class="visually-hidden" for="filter-category">Filter by category</label><select id="filter-category"><option value="">All categories</option>${selectOptions(COMPLAINT_CATEGORIES)}</select>
      <label class="visually-hidden" for="filter-priority">Filter by priority</label><select id="filter-priority"><option value="">All priorities</option>${selectOptions(COMPLAINT_PRIORITIES)}</select>
      <label class="visually-hidden" for="filter-status">Filter by status</label><select id="filter-status"><option value="">All statuses</option>${selectOptions(COMPLAINT_STATUSES)}</select></div>`;
  }

  function adminTable(items) {
    const complaints = Array.isArray(items) ? items.map(normalizeComplaint) : [];
    const hasFilters = Boolean(adminListState.query || adminListState.category || adminListState.priority || adminListState.status);
    const emptyTitle = hasFilters ? "No matching complaints on this page" : "No complaints received";
    const emptyText = adminListState.nextToken
      ? "No results on this page. Continue to the next page to keep searching."
      : hasFilters
        ? "Try changing the search text or filters."
        : "New submissions will appear here.";
    const table = complaints.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Complaint</th><th>Student</th><th>Category</th><th>Priority</th><th>Status</th><th>Submitted</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${complaints.map((item) => `<tr><td><span class="table-title">${escapeHtml(item.title)}</span><span class="complaint-id">${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.ownerName || "—")}<span class="table-secondary">${escapeHtml(item.ownerEmail)}</span></td><td>${escapeHtml(item.category)}</td><td>${priorityBadge(item.priority)}</td><td>${statusBadge(item.status)}</td><td>${dateText(item.createdAt)}</td><td class="table-actions"><a class="button button-secondary button-small" href="${complaintHref(item.id, true)}">Details</a></td></tr>`).join("")}</tbody></table></div>` : emptyState(emptyTitle, emptyText);
    document.getElementById("admin-table-region").innerHTML = table;
    document.getElementById("admin-pagination").innerHTML = `<div class="pagination"><span id="results-count" aria-live="polite">Page ${adminListState.page + 1} · Showing ${complaints.length} complaints</span><div class="pagination-actions"><button class="button button-secondary button-small" type="button" data-action="admin-previous-page"${adminListState.page === 0 ? " disabled" : ""}>← Previous</button><button class="button button-secondary button-small" type="button" data-action="admin-next-page"${adminListState.nextToken ? "" : " disabled"}>Next →</button></div></div>`;
  }

  function adminComplaintsPage() {
    return `${pageHeading("Administration", "Complaint management", "Search, filter, and review live reports. Every status change is sent to the backend.")}<p class="auth-alert" id="admin-list-error" role="alert" hidden></p>${adminFilters()}<section class="panel"><div id="admin-table-region" aria-live="polite"><p class="muted">Loading complaints…</p></div><div id="admin-pagination"></div></section>`;
  }

  function complaintDetailPage(adminMode) {
    const page = adminMode ? "Complaint management" : "Student space";
    return `<div id="complaint-detail-region" aria-live="polite">${pageHeading(page, "Complaint details", "Loading the latest complaint record from the backend.")}<section class="panel"><p class="muted">Loading complaint details…</p></section></div>`;
  }

  function renderStudentComplaintList(items) {
    const region = document.getElementById("student-complaints-region");
    const complaints = Array.isArray(items) ? items.map(normalizeComplaint) : [];
    region.innerHTML = complaints.length
      ? `<div class="complaint-list">${complaints.map((item) => `<article class="complaint-card"><div><h3>${escapeHtml(item.title)}</h3><div class="complaint-meta"><span class="complaint-id">${escapeHtml(item.id)}</span><span>${escapeHtml(item.category)}</span><span>${dateText(item.createdAt)}</span></div></div><div class="complaint-card-actions">${statusBadge(item.status)}${priorityBadge(item.priority)}<a class="button button-secondary button-small" href="${complaintHref(item.id, false)}">View details</a></div></article>`).join("")}</div>`
      : emptyState("No complaints yet", "Your live submissions and their updates will appear here.", `<a class="button button-small" href="submit-complaint.html">Submit a complaint</a>`);
    document.getElementById("student-complaints-pagination").innerHTML = `<div class="pagination"><span aria-live="polite">Page ${studentListState.page + 1} · Showing ${complaints.length} complaints</span><div class="pagination-actions"><button class="button button-secondary button-small" type="button" data-action="student-previous-page"${studentListState.page === 0 ? " disabled" : ""}>← Previous</button><button class="button button-secondary button-small" type="button" data-action="student-next-page"${studentListState.nextToken ? "" : " disabled"}>Next →</button></div></div>`;
  }

  async function loadStudentComplaints() {
    const region = document.getElementById("student-complaints-region");
    const requestId = ++studentListState.requestId;
    region.innerHTML = `<p class="muted">Loading your complaints…</p>`;
    document.getElementById("student-complaints-pagination").innerHTML = "";
    const params = new URLSearchParams({ limit: String(studentListState.pageSize) });
    const token = studentListState.pageTokens[studentListState.page];
    if (token) params.set("nextToken", token);
    try {
      const result = await auth.apiRequest(`/complaints/my?${params.toString()}`);
      if (requestId !== studentListState.requestId) return;
      studentListState.nextToken = typeof result.nextToken === "string" ? result.nextToken : null;
      if (studentListState.nextToken) studentListState.pageTokens[studentListState.page + 1] = studentListState.nextToken;
      else studentListState.pageTokens.length = studentListState.page + 1;
      renderStudentComplaintList(result.items);
    } catch (error) {
      if (requestId !== studentListState.requestId) return;
      region.innerHTML = `<div class="auth-alert" role="alert">${escapeHtml(error && error.message ? error.message : "Your complaints could not be loaded.")}<br><button class="button button-secondary button-small" type="button" data-action="retry-student-list">Try again</button></div>`;
    }
  }

  async function loadComplaintDetails(adminMode) {
    const region = document.getElementById("complaint-detail-region");
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      region.innerHTML = `<section class="panel">${emptyState("Complaint ID is missing", "Return to the complaint list and choose a complaint.")}</section>`;
      return;
    }
    region.innerHTML = `<section class="panel"><p class="muted">Loading the latest complaint details…</p></section>`;
    try {
      const item = await auth.apiRequest(`/complaints/${encodeURIComponent(id)}`);
      if (!item || typeof item !== "object" || !(item.complaintId || item.id)) {
        throw new Error("The backend returned an invalid complaint record.");
      }
      const complaint = normalizeComplaint(item);
      region.innerHTML = complaintDetailsContent(complaint, adminMode);
      if (adminMode) bindManagementForm(complaint);
    } catch (error) {
      region.innerHTML = `<section class="panel" role="alert">${emptyState("Complaint unavailable", error && error.message ? error.message : "The complaint could not be loaded.")}<a class="button button-secondary button-small" href="${adminMode ? "admin-complaints.html" : "my-complaints.html"}">Back to complaints</a></section>`;
    }
  }

  function statValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  async function loadStudentDashboard() {
    const errorRegion = document.getElementById("student-dashboard-error");
    errorRegion.hidden = true;
    try {
      const stats = await auth.apiRequest("/complaints/my/stats");
      document.getElementById("student-total").textContent = statValue(stats.totalComplaints);
      document.getElementById("student-pending").textContent = statValue(stats.pendingComplaints);
      document.getElementById("student-in-progress").textContent = statValue(stats.inProgressComplaints);
      document.getElementById("student-resolved").textContent = statValue(stats.resolvedComplaints);
      const counts = {
        Pending: statValue(stats.pendingComplaints),
        "In Progress": statValue(stats.inProgressComplaints),
        Resolved: statValue(stats.resolvedComplaints)
      };
      document.getElementById("student-status-chart").innerHTML =
        statusChart(counts, statValue(stats.totalComplaints));
      const items = Array.isArray(stats.recentComplaints)
        ? stats.recentComplaints.map(normalizeComplaint)
        : [];
      document.getElementById("student-dashboard-recent").innerHTML = items.length
        ? `<div class="complaint-list">${items.slice(0, 4).map((item) => complaintCard(item, false)).join("")}</div>`
        : emptyState("Nothing submitted yet", "When you submit a complaint, it will appear here.", `<a class="button button-small" href="submit-complaint.html">Submit your first complaint</a>`);
    } catch (error) {
      errorRegion.innerHTML = `${escapeHtml(error && error.message ? error.message : "Dashboard data could not be loaded.")} <button class="button button-secondary button-small" type="button" data-action="retry-student-dashboard">Try again</button>`;
      errorRegion.hidden = false;
      document.getElementById("student-dashboard-recent").innerHTML = "";
    }
  }

  async function loadAdminDashboard() {
    const errorRegion = document.getElementById("admin-dashboard-error");
    errorRegion.hidden = true;
    try {
      const [stats, recent] = await Promise.all([
        auth.apiRequest("/admin/stats"),
        auth.apiRequest("/admin/complaints?limit=5")
      ]);
      document.getElementById("admin-total").textContent = statValue(stats.totalComplaints);
      document.getElementById("admin-pending").textContent = statValue(stats.pendingComplaints);
      document.getElementById("admin-in-progress").textContent = statValue(stats.inProgressComplaints);
      document.getElementById("admin-resolved").textContent = statValue(stats.resolvedComplaints);

      const categories = stats.categories && typeof stats.categories === "object" ? stats.categories : {};
      const categoryValues = COMPLAINT_CATEGORIES.map((category) => ({
        category,
        count: statValue(categories[category])
      }));
      const maxCategory = Math.max(1, ...categoryValues.map((item) => item.count));
      document.getElementById("admin-categories").innerHTML = `<div class="category-list">${categoryValues.map((item) => `<div class="category-stat"><div class="category-row"><span>${escapeHtml(item.category)}</span><strong>${item.count}</strong></div><div class="category-track"><span style="width:${Math.round(item.count / maxCategory * 100)}%"></span></div></div>`).join("")}</div>`;

      const counts = {
        Pending: statValue(stats.pendingComplaints),
        "In Progress": statValue(stats.inProgressComplaints),
        Resolved: statValue(stats.resolvedComplaints)
      };
      document.getElementById("admin-status-chart").innerHTML = statusChart(counts, statValue(stats.totalComplaints));
      const items = Array.isArray(recent.items) ? recent.items.map(normalizeComplaint) : [];
      document.getElementById("admin-recent").innerHTML = items.length
        ? `<div class="complaint-list">${items.slice(0, 5).map((item) => complaintCard(item, true)).join("")}</div>`
        : emptyState("No complaints received", "New submissions will appear here.");
    } catch (error) {
      errorRegion.innerHTML = `${escapeHtml(error && error.message ? error.message : "Dashboard data could not be loaded.")} <button class="button button-secondary button-small" type="button" data-action="retry-admin-dashboard">Try again</button>`;
      errorRegion.hidden = false;
    }
  }

  async function loadAdminComplaints() {
    const requestId = ++adminListState.requestId;
    const errorRegion = document.getElementById("admin-list-error");
    errorRegion.hidden = true;
    document.getElementById("admin-table-region").innerHTML = `<p class="muted">Loading complaints…</p>`;
    document.getElementById("admin-pagination").innerHTML = "";
    const params = new URLSearchParams({ limit: String(adminListState.pageSize) });
    if (adminListState.query.trim()) params.set("q", adminListState.query.trim());
    if (adminListState.category) params.set("category", adminListState.category);
    if (adminListState.priority) params.set("priority", adminListState.priority);
    if (adminListState.status) params.set("status", adminListState.status);
    const token = adminListState.pageTokens[adminListState.page];
    if (token) params.set("nextToken", token);

    try {
      const result = await auth.apiRequest(`/admin/complaints?${params.toString()}`);
      if (requestId !== adminListState.requestId) return;
      adminListState.nextToken = typeof result.nextToken === "string" ? result.nextToken : null;
      if (adminListState.nextToken) adminListState.pageTokens[adminListState.page + 1] = adminListState.nextToken;
      else adminListState.pageTokens.length = adminListState.page + 1;
      adminTable(result.items);
    } catch (error) {
      if (requestId !== adminListState.requestId) return;
      errorRegion.innerHTML = `${escapeHtml(error && error.message ? error.message : "Complaints could not be loaded.")} <button class="button button-secondary button-small" type="button" data-action="retry-admin-list">Try again</button>`;
      errorRegion.hidden = false;
      document.getElementById("admin-table-region").innerHTML = "";
    }
  }

  function resetAdminList() {
    adminListState.page = 0;
    adminListState.pageTokens = [null];
    adminListState.nextToken = null;
    loadAdminComplaints();
  }

  function fatalPage(message) {
    app.innerHTML = `${header(null, "", false)}<main class="page-main"><div class="container"><section class="panel"><p class="eyebrow">CampusCare</p><h1>We couldn’t load the app</h1><p class="muted">${escapeHtml(message)}</p><button class="button button-secondary" type="button" data-action="reload">Reload page</button></section></div></main>`;
  }

  function authBlockedPage(page, message) {
    const adminPage = ADMIN_PAGES.includes(page);
    const title = adminPage ? "Administrator verification required" : "Secure backend verification unavailable";
    return `${header(null, page, false)}<main class="page-main"><div class="container"><section class="panel"><p class="eyebrow">CampusCare security check</p><h1>${title}</h1><p class="auth-alert" role="alert">${escapeHtml(message)}</p><p class="muted">No complaint data was loaded. Protected pages stay locked until the backend verifies this Cognito session.</p><div class="hero-actions"><a class="button button-secondary" href="index.html">Return home</a><button class="button" type="button" data-action="logout">Sign out</button></div></section></div></main>`;
  }

  function toast(message) {
    const element = document.getElementById("toast");
    if (!element) return;
    element.textContent = message;
    element.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => { element.hidden = true; }, 3500);
  }

  function setFormError(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
  }

  async function beginAuthentication(screenHint) {
    const errorId = screenHint === "signup" ? "register-error" : "login-error";
    setFormError(errorId, "");
    const button = document.querySelector(`[data-action="cognito-${screenHint === "signup" ? "signup" : "login"}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = "Connecting to Cognito…";
    }
    try {
      await auth.beginSignIn(screenHint);
    } catch (error) {
      setFormError(errorId, error && error.message ? error.message : "Cognito sign-in could not be started.");
      if (button) {
        button.disabled = false;
        button.textContent = screenHint === "signup" ? "Continue to student registration" : "Continue to sign in";
      }
    }
  }

  function bindComplaintForm() {
    const form = document.getElementById("complaint-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormError("complaint-error", "");
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const title = String(data.get("title")).trim();
      const description = String(data.get("description")).trim();
      const category = String(data.get("category"));
      const location = String(data.get("location"));
      const priority = String(data.get("priority") || "");
      if (title.length < 3 || !COMPLAINT_CATEGORIES.includes(category) || !COMPLAINT_LOCATIONS.includes(location) ||
          !COMPLAINT_PRIORITIES.includes(priority) || description.length < 20) {
        setFormError("complaint-error", "Review the required fields and make sure the description has at least 20 characters.");
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Submitting…";
      try {
        const result = await auth.apiRequest("/complaints", {
          method: "POST",
          body: { title, description, category, location, priority }
        });
        const id = result && (result.complaintId || result.id);
        if (!id) throw new Error("The backend did not return a complaint ID.");
        window.location.href = complaintHref(id, false);
      } catch (error) {
        setFormError("complaint-error", error && error.message ? error.message : "The complaint could not be submitted.");
        button.disabled = false;
        button.textContent = "Submit complaint";
      }
    });
  }

  function bindManagementForm(item) {
    const form = document.getElementById("manage-form");
    const statusSelect = form.querySelector('[name="status"]');
    const remarkInput = form.querySelector('[name="remark"]');
    const updateRemarkRequirement = () => {
      const resolving = statusSelect.value === "Resolved";
      remarkInput.required = resolving;
      document.getElementById("manage-remark-hint").textContent = resolving
        ? "A non-empty remark is required to resolve this complaint."
        : "Remarks cannot be cleared once saved. A resolution requires a remark.";
    };
    statusSelect.addEventListener("change", updateRemarkRequirement);
    updateRemarkRequirement();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setFormError("manage-error", "");
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const status = String(data.get("status"));
      const remark = String(data.get("remark")).trim();
      if (!COMPLAINT_STATUSES.includes(status) || remark.length > 1000) {
        setFormError("manage-error", "Choose a valid status and keep remarks under 1,000 characters.");
        return;
      }
      const payload = { status };
      if (remark !== item.adminRemark || status === "Resolved") payload.adminRemark = remark;
      if (status === item.status && remark === item.adminRemark) {
        setFormError("manage-error", "There are no changes to save.");
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const updated = await auth.apiRequest(`/admin/complaints/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: payload
        });
        const complaint = normalizeComplaint(updated);
        document.getElementById("complaint-detail-region").innerHTML = complaintDetailsContent(complaint, true);
        bindManagementForm(complaint);
        toast("Complaint update saved. The student will see the new status.");
      } catch (error) {
        setFormError("manage-error", error && error.message ? error.message : "The update could not be saved.");
        button.disabled = false;
        button.textContent = "Save updates";
      }
    });
  }

  function bindAdminFilters() {
    let searchTimer = 0;
    document.getElementById("filter-search").addEventListener("input", (event) => {
      adminListState.query = event.target.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(resetAdminList, 250);
    });
    [["filter-category", "category"], ["filter-priority", "priority"], ["filter-status", "status"]].forEach(([id, key]) => {
      document.getElementById(id).addEventListener("change", (event) => {
        adminListState[key] = event.target.value;
        resetAdminList();
      });
    });
    loadAdminComplaints();
  }

  function moveAdminPage(direction) {
    if (direction > 0 && adminListState.nextToken) {
      adminListState.page += 1;
    } else if (direction < 0 && adminListState.page > 0) {
      adminListState.page -= 1;
    } else {
      return;
    }
    loadAdminComplaints();
  }

  function moveStudentPage(direction) {
    if (direction > 0 && studentListState.nextToken) {
      studentListState.page += 1;
    } else if (direction < 0 && studentListState.page > 0) {
      studentListState.page -= 1;
    } else {
      return;
    }
    loadStudentComplaints();
  }

  function bindGlobalActions() {
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "logout") {
        auth.signOut().catch((error) => toast(error && error.message ? error.message : "Sign-out could not be completed."));
      } else if (action.dataset.action === "cognito-login") {
        beginAuthentication("login");
      } else if (action.dataset.action === "cognito-signup") {
        beginAuthentication("signup");
      } else if (action.dataset.action === "reload") {
        window.location.reload();
      } else if (action.dataset.action === "admin-previous-page") {
        moveAdminPage(-1);
      } else if (action.dataset.action === "admin-next-page") {
        moveAdminPage(1);
      } else if (action.dataset.action === "student-previous-page") {
        moveStudentPage(-1);
      } else if (action.dataset.action === "student-next-page") {
        moveStudentPage(1);
      } else if (action.dataset.action === "retry-admin-dashboard") {
        loadAdminDashboard();
      } else if (action.dataset.action === "retry-student-dashboard") {
        loadStudentDashboard();
      } else if (action.dataset.action === "retry-admin-list") {
        loadAdminComplaints();
      } else if (action.dataset.action === "retry-student-list") {
        loadStudentComplaints();
      }
    });
  }

  async function render() {
    const page = document.body.dataset.page;
    if (!PAGE_TITLES[page]) throw new Error("This CampusCare page is not configured.");
    document.title = PAGE_TITLES[page];
    const callback = await auth.handleCallback();
    let user = null;
    let authMessage = callback.error || "";
    const protectedPage = STUDENT_PAGES.includes(page) || ADMIN_PAGES.includes(page);

    if (protectedPage) {
      try {
        const access = await auth.authorizePage(ADMIN_PAGES.includes(page) ? "admin" : "student");
        if (!access.authenticated) {
          window.location.replace("student-login.html");
          return;
        }
        user = access.user;
        if ((STUDENT_PAGES.includes(page) && user.role !== "student") ||
            (ADMIN_PAGES.includes(page) && user.role !== "admin")) {
          window.location.replace(homeFor(user));
          return;
        }
      } catch (error) {
        app.innerHTML = authBlockedPage(page, error && error.message ? error.message : "The backend could not verify this session.");
        bindGlobalActions();
        return;
      }
    } else {
      try {
        const session = await auth.getSession();
        if (session) {
          const access = await auth.authorizePage(null);
          user = access.authenticated ? access.user : null;
        }
      } catch (error) {
        authMessage = error && error.message ? error.message : "The saved sign-in session could not be checked.";
      }
    }

    if ((page === "login" || page === "register") && user) {
      window.location.replace(homeFor(user));
      return;
    }
    if (page === "landing" && callback.handled && user) {
      window.location.replace(homeFor(user));
      return;
    }

    const configStatus = auth.configurationStatus();
    if (!configStatus.configured && ["landing", "login", "register"].includes(page) && !authMessage) {
      authMessage = configStatus.message;
    }
    if (page === "landing") app.innerHTML = landingPage(user, authMessage);
    else if (page === "login") app.innerHTML = `${header(null, "", false)}${loginPage(authMessage)}<footer class="site-footer"><div class="container footer-inner"><span>CampusCare · A more connected campus</span><span>Secure Cognito sign-in</span></div></footer>`;
    else if (page === "register") app.innerHTML = `${header(null, "", false)}${registerPage(authMessage)}<footer class="site-footer"><div class="container footer-inner"><span>CampusCare · A more connected campus</span><span>Secure Cognito registration</span></div></footer>`;
    else if (page === "student-dashboard") app.innerHTML = shell(studentDashboard(user), user, page);
    else if (page === "submit-complaint") app.innerHTML = shell(submitPage(), user, page);
    else if (page === "my-complaints") app.innerHTML = shell(studentComplaints(), user, page);
    else if (page === "complaint-details") app.innerHTML = shell(complaintDetailPage(false), user, page);
    else if (page === "admin-dashboard") app.innerHTML = shell(adminDashboard(), user, page);
    else if (page === "admin-complaints") app.innerHTML = shell(adminComplaintsPage(), user, page);
    else if (page === "admin-complaint-details") app.innerHTML = shell(complaintDetailPage(true), user, page);

    bindGlobalActions();
    if (page === "submit-complaint") bindComplaintForm();
    if (page === "student-dashboard") loadStudentDashboard();
    if (page === "my-complaints") loadStudentComplaints();
    if (page === "complaint-details") loadComplaintDetails(false);
    if (page === "admin-dashboard") loadAdminDashboard();
    if (page === "admin-complaints") bindAdminFilters();
    if (page === "admin-complaint-details") loadComplaintDetails(true);
  }

  render().catch((error) => {
    fatalPage(error && error.message ? error.message : "An unexpected browser error occurred.");
    bindGlobalActions();
  });
}());
