import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);

const loginView = $("loginView");
const dashboardView = $("dashboardView");
const detailView = $("detailView");
const logoutBtn = $("logoutBtn");
const loginBtn = $("loginBtn");
const refreshBtn = $("refreshBtn");
const backBtn = $("backBtn");
const loginMessage = $("loginMessage");
const dashboardMessage = $("dashboardMessage");
const detailMessage = $("detailMessage");
const applicationsList = $("applicationsList");
const detailContent = $("detailContent");

let currentApplication = null;
let applicationsData = [];

function showMessage(target, text, type = "error") {
  target.innerHTML = text ? `<div class="notice ${type}">${escapeHtml(text)}</div>` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function vehicleLabel(vehicle, role) {
  if (vehicle === "bike") return "🏍️ Bike Rider";
  if (vehicle === "auto") return "🛺 Auto Driver";
  if (vehicle === "car") return "🚕 Car Driver";
  return `${role || "Partner"}`;
}

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function requireAdmin() {
  const session = await getSession();
  if (!session?.user) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, phone")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data || data.role !== "admin") {
    await supabase.auth.signOut();
    throw new Error("This account is not an Admin account.");
  }

  return true;
}

async function loadDashboardOverview(){
  const ids = {
    pending: document.getElementById("overviewPending"),
    accepted: document.getElementById("overviewAccepted"),
    inProgress: document.getElementById("overviewInProgress"),
    completed: document.getElementById("overviewCompleted"),
    cancelled: document.getElementById("overviewCancelled"),
    online: document.getElementById("overviewOnline"),
    offline: document.getElementById("overviewOffline"),
    fare: document.getElementById("overviewFare"),
    updated: document.getElementById("overviewUpdated")
  };

  if(!ids.pending) return;

  const [bookingResult, partnerResult] = await Promise.all([
    supabase.from("bookings").select("status,fare_amount"),
    supabase.from("profiles").select("id,is_online").in("role", ["driver","rider"])
  ]);

  if(bookingResult.error){
    console.error("Overview bookings error:", bookingResult.error);
    showMessage(document.getElementById("overviewMessage"),
      bookingResult.error.message || "Could not load booking overview.");
    return;
  }

  if(partnerResult.error){
    console.error("Overview partners error:", partnerResult.error);
    showMessage(document.getElementById("overviewMessage"),
      partnerResult.error.message || "Could not load partner overview.");
    return;
  }

  const bookings = bookingResult.data || [];
  const partners = partnerResult.data || [];
  const count = status => bookings.filter(b => String(b.status || "").toLowerCase() === status).length;
  const completed = bookings.filter(b => String(b.status || "").toLowerCase() === "completed");

  const totalFare = completed.reduce((sum,b) => {
    const value = Number(b.fare_amount);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  ids.pending.textContent = count("pending");
  ids.accepted.textContent = count("accepted");
  ids.inProgress.textContent = count("in_progress");
  ids.completed.textContent = count("completed");
  ids.cancelled.textContent = count("cancelled");
  ids.online.textContent = partners.filter(p => p.is_online === true).length;
  ids.offline.textContent = partners.filter(p => p.is_online !== true).length;
  ids.fare.textContent = "₹" + totalFare.toFixed(2);
  ids.updated.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", {
    timeZone:"Asia/Kolkata", hour:"2-digit", minute:"2-digit"
  }) + " IST";
}


async function loadActionCenter(){
  const grid = document.getElementById("actionCenterGrid");
  if(!grid) return;

  const [applicationsResult, bookingsResult, historyRequestsResult] = await Promise.all([
    supabase.from("driver_rider_applications").select("status"),
    supabase.from("bookings").select("id,status,driver_id,payment_status,payment_method,razorpay_payment_id,fare_amount,created_at"),
    supabase.from("older_ride_history_requests").select("status")
  ]);

  const message = document.getElementById("actionCenterMessage");
  if(applicationsResult.error || bookingsResult.error || historyRequestsResult.error){
    const err = applicationsResult.error || bookingsResult.error || historyRequestsResult.error;
    console.warn("Action Center load error:", err);
    if(message) showMessage(message, err?.message || "Could not load Action Center.");
    return;
  }

  const applications = applicationsResult.data || [];
  const bookings = bookingsResult.data || [];
  const historyRequests = historyRequestsResult.data || [];
  const norm = v => String(v || "").trim().toLowerCase();

  const pendingApplications = applications.filter(a => norm(a.status) === "pending").length;
  const unassignedPending = bookings.filter(b => norm(b.status) === "pending" && !b.driver_id).length;
  const paymentIssues = bookings.filter(b => paymentIssueReason(b)).length;
  const pendingHistoryRequests = historyRequests.filter(r => norm(r.status) === "pending").length;

  let safetyAlerts = 0;
  const active = bookings.filter(b => (norm(b.status) === "accepted" || norm(b.status) === "in_progress") && b.driver_id);
  if(active.length){
    const ids = [...new Set(active.map(b => b.driver_id).filter(Boolean))];
    const { data: partners, error: partnerError } = await supabase
      .from("profiles")
      .select("id,is_online")
      .in("id", ids);
    if(!partnerError){
      const onlineMap = new Map((partners || []).map(p => [p.id, p.is_online === true]));
      const now = Date.now();
      for(const b of active){
        const age = Number.isFinite(new Date(b.created_at).getTime())
          ? Math.floor((now - new Date(b.created_at).getTime()) / 60000)
          : 0;
        if(onlineMap.get(b.driver_id) === false) safetyAlerts++;
        if(norm(b.status) === "accepted" && age >= 20) safetyAlerts++;
        if(norm(b.status) === "in_progress" && age >= 120) safetyAlerts++;
      }
    }
  }

  const items = [
    {
      title:"Pending applications",
      count:pendingApplications,
      help:"Partner applications awaiting Admin review.",
      alert:pendingApplications > 0,
      action:"Review applications",
      fn:"applications"
    },
    {
      title:"Unassigned pending rides",
      count:unassignedPending,
      help:"Pending bookings without a Driver/Rider.",
      alert:unassignedPending > 0,
      action:"Open bookings",
      fn:"needs_attention"
    },
    {
      title:"Payment issues",
      count:paymentIssues,
      help:"Completed rides with incomplete payment records.",
      alert:paymentIssues > 0,
      action:"View payment issues",
      fn:"bookings"
    },
    {
      title:"Ride safety alerts",
      count:safetyAlerts,
      help:"Active-ride operational warnings.",
      alert:safetyAlerts > 0,
      action:"View active rides",
      fn:"bookings"
    },
    {
      title:"Older history requests",
      count:pendingHistoryRequests,
      help:"Customer requests waiting for older ride history to be sent.",
      alert:pendingHistoryRequests > 0,
      action:"View requests",
      fn:"history_requests"
    }
  ];

  grid.innerHTML = items.map(item => `
    <div class="action-item ${item.alert ? "alert" : ""}">
      <div class="action-title">${escapeHtml(item.title)}</div>
      <div class="action-count">${item.count}</div>
      <div class="action-help">${escapeHtml(item.help)}</div>
      <button class="action-btn" data-action-center="${escapeHtml(item.fn)}">${escapeHtml(item.action)}</button>
    </div>
  `).join("");

  grid.querySelectorAll("[data-action-center]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.actionCenter;
      if(action === "applications"){
        setAdminTab("applications");
        return;
      }
      if(action === "history_requests"){
        setAdminTab("history_requests");
        const filter = document.getElementById("historyRequestStatusFilter");
        if(filter) filter.value = "pending";
        return;
      }
      setAdminTab("bookings");
      if(action === "needs_attention"){
        const filter = document.getElementById("bookingStatusFilter");
        if(filter) filter.value = "needs_attention";
        renderAdminBookings();
      }
    });
  });

  const updated = document.getElementById("actionCenterUpdated");
  if(updated){
    updated.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", {
      timeZone:"Asia/Kolkata", hour:"2-digit", minute:"2-digit"
    }) + " IST";
  }
}

let olderHistoryRequestsData = [];
const expandedHistoryRequestIds = new Set();

function historyRequestStatusLabel(value){
  const v = String(value || "").toLowerCase();
  return ({pending:"Pending",completed:"Completed",cancelled:"Cancelled"})[v] || value || "—";
}

function olderHistoryRequestDate(value){
  return formatAdminIST(value);
}

function renderOlderHistorySummary(){
  const el = document.getElementById("historyRequestsSummary");
  if(!el) return;
  const all = olderHistoryRequestsData;
  const count = status => all.filter(r => String(r.status || "").toLowerCase() === status).length;
  el.innerHTML = `
    <div class="overview-stat"><b>Total requests</b><div class="overview-value">${all.length}</div></div>
    <div class="overview-stat"><b>Pending</b><div class="overview-value">${count("pending")}</div></div>
    <div class="overview-stat"><b>Completed</b><div class="overview-value">${count("completed")}</div></div>
    <div class="overview-stat"><b>Cancelled</b><div class="overview-value">${count("cancelled")}</div></div>
  `;
}

function renderOlderHistoryRequests(){
  const list = document.getElementById("historyRequestsList");
  const filter = document.getElementById("historyRequestStatusFilter");
  if(!list) return;

  const wanted = String(filter?.value || "all").toLowerCase();
  const rows = olderHistoryRequestsData.filter(r =>
    wanted === "all" || String(r.status || "").toLowerCase() === wanted
  );

  renderOlderHistorySummary();

  if(!rows.length){
    list.innerHTML = `<div class="card"><div class="history-request-empty muted">No ${wanted === "all" ? "" : wanted + " "}older ride history requests found.</div></div>`;
    return;
  }

  list.innerHTML = rows.map(r => {
    const status = String(r.status || "").toLowerCase();
    const expanded = expandedHistoryRequestIds.has(r.id);
    return `
      <div class="history-request-card ${escapeHtml(status)}" data-history-request-card="${escapeHtml(r.id)}">
        <div class="toolbar">
          <div>
            <strong>${escapeHtml(r.email || "No email recorded")}</strong>
            <div class="muted">Request ID: ${escapeHtml(r.id)}</div>
          </div>
          <span class="history-request-badge ${escapeHtml(status)}">${escapeHtml(historyRequestStatusLabel(r.status))}</span>
        </div>
        <div class="history-request-grid">
          <div><b>Requested</b><br>${escapeHtml(olderHistoryRequestDate(r.requested_at))}</div>
          <div><b>Customer ID</b><br>${escapeHtml(r.user_id || "—")}</div>
          <div><b>Older rides available</b><br><span data-history-count="${escapeHtml(r.id)}">Loading...</span></div>
        </div>
        <div class="history-request-actions">
          <button class="secondary" data-history-view="${escapeHtml(r.id)}">${expanded ? "Hide older rides" : "View older rides"}</button>
          ${status === "pending" ? `<button class="primary" data-history-complete="${escapeHtml(r.id)}">Mark as sent & completed</button>` : ""}
        </div>
        ${expanded ? `<div class="history-request-older-list" id="historyOlderRides_${escapeHtml(r.id)}"><div class="muted">Loading older rides...</div></div>` : ""}
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-history-view]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.historyView;
      if(!id) return;
      if(expandedHistoryRequestIds.has(id)){
        expandedHistoryRequestIds.delete(id);
        renderOlderHistoryRequests();
      }else{
        expandedHistoryRequestIds.add(id);
        renderOlderHistoryRequests();
        await loadOlderRidesForRequest(id);
      }
    });
  });

  list.querySelectorAll("[data-history-complete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.historyComplete;
      if(!id) return;
      await markOlderHistoryRequestCompleted(id);
    });
  });

  // Load counts for every visible request without exposing rides until Admin asks to view them.
  rows.forEach(r => void loadOlderRideCount(r));
}

async function loadOlderRideCount(request){
  const target = document.querySelector(`[data-history-count="${request.id}"]`);
  if(!target) return;

  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count:"exact", head:true })
    .eq("user_id", request.user_id)
    .in("status", ["completed","cancelled"]);

  if(error){
    target.textContent = "—";
    return;
  }
  target.textContent = String(Math.max(0, Number(count || 0) - 7));
}

async function loadOlderRidesForRequest(requestId){
  const request = olderHistoryRequestsData.find(r => r.id === requestId);
  const target = document.getElementById(`historyOlderRides_${requestId}`);
  if(!request || !target) return;

  const { data, error } = await supabase
    .from("bookings")
    .select("id,service,pickup_location,destination,booking_date,booking_time,status,distance_km,fare_amount,payment_status,payment_method,created_at")
    .eq("user_id", request.user_id)
    .in("status", ["completed","cancelled"])
    .order("created_at", { ascending:false });

  if(error){
    target.innerHTML = `<div class="notice error">Could not load older rides: ${escapeHtml(error.message || "Unknown error")}</div>`;
    return;
  }

  const older = (data || []).slice(7);

  if(!older.length){
    target.innerHTML = `<div class="muted">No rides older than the customer's 7 most recent rides are currently available.</div>`;
    return;
  }

  target.innerHTML = `
    <strong>Older rides to send by email</strong>
    ${older.map(ride => `
      <div class="history-ride-row">
        <div><b>${escapeHtml(adminVehicleLabel(ride.service))}</b> · ${escapeHtml(adminStatusLabel(ride.status))}</div>
        <div class="muted">${escapeHtml(formatAdminIST(ride.created_at || ((ride.booking_date || "") + "T" + (ride.booking_time || ""))))}</div>
        <div style="margin-top:7px"><b>From:</b> ${escapeHtml(ride.pickup_location || "—")}</div>
        <div><b>To:</b> ${escapeHtml(ride.destination || "—")}</div>
        <div style="margin-top:7px"><b>Distance:</b> ${escapeHtml(ride.distance_km == null ? "—" : Number(ride.distance_km).toFixed(2) + " km")} · <b>Fare:</b> ${escapeHtml(ride.fare_amount == null ? "—" : "₹" + ride.fare_amount)}</div>
        <div><b>Payment:</b> ${escapeHtml(ride.payment_status || "—")}${ride.payment_method ? " · " + escapeHtml(ride.payment_method) : ""}</div>
      </div>
    `).join("")}
  `;
}

async function loadOlderHistoryRequests(){
  const list = document.getElementById("historyRequestsList");
  const message = document.getElementById("historyRequestsMessage");
  if(!list) return;

  list.innerHTML = `<div class="card"><div class="notice">Loading older history requests...</div></div>`;
  if(message) showMessage(message, "");

  const { data, error } = await supabase
    .from("older_ride_history_requests")
    .select("id,user_id,email,requested_at,status")
    .order("requested_at", { ascending:false });

  if(error){
    olderHistoryRequestsData = [];
    renderOlderHistorySummary();
    list.innerHTML = `<div class="card"><div class="notice error">Could not load older history requests: ${escapeHtml(error.message || "Unknown error")}</div></div>`;
    if(message) showMessage(message, "Make sure the older ride history request SQL and Admin RLS policies have been applied in Supabase.");
    return;
  }

  olderHistoryRequestsData = data || [];
  renderOlderHistoryRequests();
}

async function markOlderHistoryRequestCompleted(requestId){
  const request = olderHistoryRequestsData.find(r => r.id === requestId);
  if(!request || String(request.status || "").toLowerCase() !== "pending") return;

  const ok = window.confirm(`Mark the older ride history request for ${request.email || "this customer"} as sent and completed?`);
  if(!ok) return;

  const { error } = await supabase
    .from("older_ride_history_requests")
    .update({ status:"completed" })
    .eq("id", requestId);

  if(error){
    showMessage(document.getElementById("historyRequestsMessage"), error.message || "Could not update request.");
    return;
  }

  request.status = "completed";
  renderOlderHistoryRequests();
  await loadActionCenter();
}

async function showDashboard() {
  loginView.classList.add("hidden");
  detailView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  await loadDashboardOverview();
  await loadActionCenter();
  await loadApplications();
  const activeTab = document.querySelector(".admin-tab.active")?.id;
  if(activeTab === "bookingsTab") await loadAdminBookings();
  if(activeTab === "partnersTab") await loadAdminPartners();
  if(activeTab === "analyticsTab") await loadAdminAnalytics();
  if(activeTab === "historyRequestsTab") await loadOlderHistoryRequests();
  if(activeTab === "payoutsTab") await loadAdminPayouts();
}

function showLogin() {
  dashboardView.classList.add("hidden");
  detailView.classList.add("hidden");
  loginView.classList.remove("hidden");
  logoutBtn.classList.add("hidden");
}


function formatAdminIST(value){
  if(!value) return "—";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    timeZone:"Asia/Kolkata",
    day:"2-digit",
    month:"short",
    year:"numeric",
    hour:"2-digit",
    minute:"2-digit",
    hour12:true
  }) + " IST";
}

function adminVehicleLabel(value){
  const v = String(value || "").toLowerCase();
  return ({bike:"Bike", auto:"Auto", car:"Car"})[v] || value || "—";
}

function adminStatusLabel(value){
  const v = String(value || "").toLowerCase();
  return ({
    pending:"Pending",
    accepted:"Accepted",
    in_progress:"In Progress",
    completed:"Completed",
    cancelled:"Cancelled"
  })[v] || value || "Unknown";
}

let adminBookings = [];
let adminProfiles = [];
let adminAssignmentPartners = [];
let adminAssignmentBusyIds = new Set();
let activeRideTimer = null;

async function loadAdminBookings(){
  const list = document.getElementById("bookingsList");
  if(!list) return;
  list.innerHTML = '<div class="card"><div class="notice">Loading bookings...</div></div>';

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .order("created_at", { ascending:false });

  if(error){
    console.error(error);
    list.innerHTML = '<div class="card"><div class="notice error">Could not load bookings: ' +
      escapeHtml(error.message || "Unknown error") + '</div></div>';
    return;
  }

  adminBookings = bookings || [];

  const ids = [...new Set(adminBookings.flatMap(b => [b.user_id, b.driver_id]).filter(Boolean))];
  adminProfiles = [];

  if(ids.length){
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
      .in("id", ids);

    if(profileError){
      console.warn("Could not load booking profiles:", profileError);
    }else{
      adminProfiles = profiles || [];
    }
  }

  // Load approved Drivers/Riders so Admin can manually assign a pending booking.
  const { data: partners, error: partnerError } = await supabase
    .from("profiles")
    .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
    .in("role", ["driver", "rider"]);

  if(partnerError){
    console.warn("Could not load assignment partners:", partnerError);
    adminAssignmentPartners = [];
  }else{
    adminAssignmentPartners = partners || [];
  }

  const partnerIds = adminAssignmentPartners.map(p => p.id).filter(Boolean);
  adminAssignmentBusyIds = new Set();
  if(partnerIds.length){
    const { data: activeRows, error: activeError } = await supabase
      .from("bookings")
      .select("id,driver_id,status")
      .in("driver_id", partnerIds)
      .in("status", ["pending", "accepted", "in_progress"]);

    if(activeError){
      console.warn("Could not load partner availability:", activeError);
    }else{
      for(const row of activeRows || []){
        if(row.driver_id) adminAssignmentBusyIds.add(row.driver_id);
      }
    }
  }

  renderPaymentIssues();
  renderRideSafetyAlerts();
  renderActiveRides();
  renderAdminBookings();
}

function formatElapsedSince(value){
  if(!value) return "—";
  const start = new Date(value).getTime();
  if(!Number.isFinite(start)) return "—";
  const diff = Math.max(0, Date.now() - start);
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if(days > 0) return `${days}d ${hours}h ${minutes}m`;
  if(hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function paymentIssueReason(booking){
  const status = String(booking?.status || "").toLowerCase();
  if(status !== "completed") return null;

  const payment = String(booking?.payment_status || "").trim().toLowerCase();
  const method = String(booking?.payment_method || "").trim().toLowerCase();
  const paymentId = String(booking?.razorpay_payment_id || "").trim();
  const fare = Number(booking?.fare_amount);

  if(payment !== "paid") {
    return `Completed ride is not marked paid (${booking?.payment_status || "not recorded"}).`;
  }
  if(Number.isFinite(fare) && fare > 0 && !method) {
    return "Payment is marked paid, but the payment method is missing.";
  }
  if(method === "razorpay" && !paymentId) {
    return "Payment is marked paid with Razorpay, but the Razorpay payment ID is missing.";
  }
  if(!Number.isFinite(fare)) {
    return "Completed ride has no valid fare amount recorded.";
  }

  return null;
}

function renderPaymentIssues(){
  const list = document.getElementById("paymentIssuesList");
  const countEl = document.getElementById("paymentIssuesCount");
  if(!list) return;

  const issues = adminBookings
    .map(b => ({ booking: b, reason: paymentIssueReason(b) }))
    .filter(x => x.reason);

  if(countEl) countEl.textContent = String(issues.length);

  if(!issues.length){
    list.innerHTML = '<div class="notice">No payment issues detected.</div>';
    return;
  }

  const profileMap = new Map(adminProfiles.map(p => [p.id, p]));
  list.innerHTML = issues.map(({booking:b, reason}) => {
    const customer = profileMap.get(b.user_id);
    const partner = profileMap.get(b.driver_id);
    return `
      <div class="payment-issue-card">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(adminVehicleLabel(b.service))} Ride</h3>
            <div class="muted small">Booking ID: ${escapeHtml(b.id || "—")}</div>
          </div>
          <span class="payment-issue-badge">Payment issue</span>
        </div>
        <div class="notice payment-watch warning">⚠️ ${escapeHtml(reason)}</div>
        <div class="payment-issue-grid">
          <div><b>Customer</b><br>${escapeHtml(customer?.full_name || b.user_id || "—")}</div>
          <div><b>Driver/Rider</b><br>${escapeHtml(partner?.full_name || b.driver_id || "—")}</div>
          <div><b>Date & time</b><br>${escapeHtml(formatAdminIST(b.created_at))}</div>
          <div><b>Fare</b><br>${b.fare_amount != null ? "₹" + escapeHtml(String(b.fare_amount)) : "—"}</div>
          <div><b>Payment status</b><br>${escapeHtml(b.payment_status || "Not recorded")}</div>
          <div><b>Payment method</b><br>${escapeHtml(b.payment_method || "Not recorded")}</div>
          <div><b>Razorpay payment ID</b><br>${escapeHtml(b.razorpay_payment_id || "Not recorded")}</div>
        </div>
      </div>`;
  }).join("");
}

function formatDurationMinutes(minutes){
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if(m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function renderRideSafetyAlerts(){
  const list = document.getElementById("rideSafetyList");
  const countEl = document.getElementById("rideSafetyCount");
  if(!list || !countEl) return;

  const now = Date.now();
  const alerts = [];
  const profileMap = new Map(adminProfiles.map(p => [p.id, p]));

  adminBookings
    .filter(b => {
      const status = String(b.status || "").toLowerCase();
      return (status === "accepted" || status === "in_progress") && !!b.driver_id;
    })
    .forEach(b => {
      const partner = profileMap.get(b.driver_id);
      const created = new Date(b.created_at).getTime();
      const ageMinutes = Number.isFinite(created) ? Math.floor((now - created) / 60000) : 0;
      const status = String(b.status || "").toLowerCase();

      if(partner && partner.is_online !== true){
        alerts.push({booking:b, partner, reason:"Assigned Driver/Rider is offline while the ride is active.", ageMinutes});
      }

      if(status === "accepted" && ageMinutes >= 20){
        alerts.push({booking:b, partner, reason:"Accepted ride has been waiting for 20+ minutes.", ageMinutes});
      }

      if(status === "in_progress" && ageMinutes >= 120){
        alerts.push({booking:b, partner, reason:"In-progress ride has been active for 2+ hours based on booking time.", ageMinutes});
      }
    });

  countEl.textContent = String(alerts.length);

  if(!alerts.length){
    list.innerHTML = '<div class="notice ok">No ride safety alerts detected.</div>';
    return;
  }

  list.innerHTML = alerts.map(({booking, partner, reason, ageMinutes}) => `
    <div class="safety-alert-card">
      <div class="row-top">
        <div>
          <h3>${escapeHtml(adminVehicleLabel(booking.service))} Ride</h3>
          <div class="muted small">Booking ID: ${escapeHtml(booking.id || "—")}</div>
        </div>
        <span class="safety-alert-badge">⚠️ Attention</span>
      </div>
      <div class="notice warning" style="margin-top:12px">${escapeHtml(reason)}</div>
      <div class="safety-alert-grid">
        <div><b>Status</b><br>${escapeHtml(adminStatusLabel(booking.status))}</div>
        <div><b>Driver/Rider</b><br>${escapeHtml(partner?.full_name || booking.driver_id || "—")}</div>
        <div><b>Partner status</b><br>${partner?.is_online ? "Online" : "Offline"}</div>
        <div><b>Booking age</b><br>${escapeHtml(formatDurationMinutes(ageMinutes))}</div>
        <div><b>Pickup</b><br>${escapeHtml(booking.pickup_location || "—")}</div>
        <div><b>Destination</b><br>${escapeHtml(booking.destination || "—")}</div>
      </div>
    </div>`).join("");
}

function renderActiveRides(){
  const list = document.getElementById("activeRidesList");
  const updated = document.getElementById("activeRidesUpdated");
  if(!list) return;

  const active = adminBookings.filter(b => {
    const status = String(b.status || "").toLowerCase();
    return (status === "accepted" || status === "in_progress") && !!b.driver_id;
  });

  const profileMap = new Map(adminProfiles.map(p => [p.id, p]));

  if(!active.length){
    list.innerHTML = '<div class="notice">No active rides right now.</div>';
  }else{
    list.innerHTML = active.map(b => {
      const partner = profileMap.get(b.driver_id);
      const status = String(b.status || "").toLowerCase();
      const label = adminStatusLabel(status);
      const payment = String(b.payment_status || "").toLowerCase();
      const paymentClass = payment === "paid" ? "ok" : "warning";
      const paymentText = payment === "paid" ? "Payment marked paid" : `Payment status: ${b.payment_status || "Not recorded"}`;
      return `
        <div class="active-ride-card ${status}">
          <div class="row-top">
            <div>
              <h3>${escapeHtml(adminVehicleLabel(b.service))} Ride</h3>
              <div class="muted small">Booking ID: ${escapeHtml(b.id || "—")}</div>
            </div>
            <span class="active-ride-badge ${status}">${escapeHtml(label)}</span>
          </div>
          <div class="active-ride-grid">
            <div><b>Driver/Rider</b><br>${escapeHtml(partner?.full_name || b.driver_id || "—")}</div>
            <div><b>Vehicle registration</b><br>${escapeHtml(partner?.vehicle_registration_number || "—")}</div>
            <div><b>Partner status</b><br>${partner?.is_online ? "Online" : "Offline"}</div>
            <div><b>Pickup</b><br>${escapeHtml(b.pickup_location || "—")}</div>
            <div><b>Destination</b><br>${escapeHtml(b.destination || "—")}</div>
            <div><b>Elapsed since booking</b><br><span class="elapsed" data-elapsed-from="${escapeHtml(b.created_at || "")}">${escapeHtml(formatElapsedSince(b.created_at))}</span></div>
            <div><b>Distance</b><br>${b.distance_km != null ? escapeHtml(String(b.distance_km)) + " km" : "—"}</div>
            <div><b>Fare</b><br>${b.fare_amount != null ? "₹" + escapeHtml(String(b.fare_amount)) : "—"}</div>
            <div><b>Payment</b><br>${escapeHtml(b.payment_status || "—")}${b.payment_method ? " • " + escapeHtml(b.payment_method) : ""}</div>
          </div>
          <div class="notice payment-watch ${paymentClass}">${escapeHtml(paymentText)}</div>
        </div>`;
    }).join("");
  }

  if(updated){
    updated.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", {timeZone:"Asia/Kolkata", hour:"2-digit", minute:"2-digit"}) + " IST";
  }

  if(activeRideTimer) clearInterval(activeRideTimer);
  activeRideTimer = setInterval(() => {
    document.querySelectorAll("[data-elapsed-from]").forEach(el => {
      el.textContent = formatElapsedSince(el.dataset.elapsedFrom);
    });
    renderRideSafetyAlerts();
  }, 30000);
}

async function assignBookingFromAdmin(bookingId, personId, button){
  if(!bookingId || !personId) return;

  if(button) button.disabled = true;

  const { data, error } = await supabase.rpc("admin_assign_booking", {
    p_booking_id: bookingId,
    p_person_id: personId
  });

  if(error){
    console.error(error);
    alert(error.message || "Could not assign the booking.");
    if(button) button.disabled = false;
    return;
  }

  const partner = adminAssignmentPartners.find(p => p.id === data || p.id === personId);
  const booking = adminBookings.find(b => b.id === bookingId);
  if(booking) booking.driver_id = data || personId;

  alert(`Booking assigned to ${partner?.full_name || "the selected Driver/Rider"}.`);
  await loadAdminBookings();
}

function assignmentOptionsForBooking(booking){
  const service = String(booking?.service || "").toLowerCase();
  const currentId = booking?.driver_id || null;

  return adminAssignmentPartners
    .filter(p => {
      if(p.id === currentId) return false;
      if(p.is_online !== true) return false;
      if(adminAssignmentBusyIds.has(p.id)) return false;

      return (
        (service === "auto" && p.role === "driver" && p.vehicle_type === "auto") ||
        (service === "car" && p.role === "driver" && p.vehicle_type === "car") ||
        (service === "bike" && p.role === "rider" && p.vehicle_type === "bike")
      );
    })
    .sort((a,b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
}

async function cancelPendingBookingFromAdmin(bookingId, button){
  if(!bookingId) return;

  const booking = adminBookings.find(b => b.id === bookingId);
  if(!booking || String(booking.status || "").toLowerCase() !== "pending") {
    alert("Only pending bookings can be cancelled from Admin.");
    return;
  }

  const partner = adminProfiles.find(p => p.id === booking.driver_id);
  const partnerText = partner?.full_name ? ` assigned to ${partner.full_name}` : "";
  if(!confirm(`Cancel this pending booking${partnerText}? This action cannot be undone.`)) return;

  if(button) {
    button.disabled = true;
    button.textContent = "Cancelling...";
  }

  const { error } = await supabase.rpc("admin_cancel_pending_booking", {
    p_booking_id: bookingId
  });

  if(error){
    console.error(error);
    alert(error.message || "Could not cancel the booking.");
    if(button){
      button.disabled = false;
      button.textContent = "Cancel Booking";
    }
    return;
  }

  alert("Booking cancelled successfully.");
  await loadAdminBookings();
  await loadDashboardOverview();
}

function renderAdminBookings(){
  const list = document.getElementById("bookingsList");
  if(!list) return;

  const filter = document.getElementById("bookingStatusFilter")?.value || "all";
  const rows = filter === "all"
    ? adminBookings
    : filter === "needs_attention"
      ? adminBookings.filter(b => String(b.status || "").toLowerCase() === "pending" && !b.driver_id)
      : adminBookings.filter(b => String(b.status || "").toLowerCase() === filter);

  if(!rows.length){
    list.innerHTML = '<div class="card"><div class="notice">No bookings found for this filter.</div></div>';
    return;
  }

  const profileMap = new Map(adminProfiles.map(p => [p.id, p]));

  list.innerHTML = rows.map(b => {
    const customer = profileMap.get(b.user_id);
    const partner = profileMap.get(b.driver_id);
    const service = adminVehicleLabel(b.service);
    const status = String(b.status || "").toLowerCase();

    const needsAttention = status === "pending" && !b.driver_id;
    const assignmentState = status !== "pending"
      ? ""
      : (b.driver_id ? "Assigned — awaiting Driver/Rider response" : "Unassigned — waiting for a matching online Driver/Rider");

    return `
      <div class="booking-card${needsAttention ? " needs-attention" : ""}">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(service)} Ride</h3>
            <div class="muted small">Booking ID: ${escapeHtml(b.id || "—")}</div>
          </div>
          <span class="pill booking-status">${escapeHtml(adminStatusLabel(status))}</span>
        </div>

        ${needsAttention ? `<div class="attention-banner">⚠️ Needs attention: this pending booking has no Driver/Rider assigned.</div>` : ""}
        ${assignmentState ? `<div class="assignment-state muted"><b>Assignment:</b> ${escapeHtml(assignmentState)}</div>` : ""}

        <div class="status-grid">
          <div><b>Customer</b><br>${escapeHtml(customer?.full_name || b.user_id || "—")}</div>
          <div><b>Driver/Rider</b><br>${escapeHtml(partner?.full_name || (b.driver_id ? b.driver_id : "Not assigned"))}</div>
          <div><b>Vehicle registration</b><br>${escapeHtml(partner?.vehicle_registration_number || "—")}</div>
          <div><b>Pickup</b><br>${escapeHtml(b.pickup_location || "—")}</div>
          <div><b>Destination</b><br>${escapeHtml(b.destination || "—")}</div>
          <div><b>Date & time</b><br>${escapeHtml(formatAdminIST(b.created_at))}</div>
          <div><b>Distance</b><br>${b.distance_km != null ? escapeHtml(String(b.distance_km)) + " km" : "—"}</div>
          <div><b>Fare</b><br>${b.fare_amount != null ? "₹" + escapeHtml(String(b.fare_amount)) : "—"}</div>
          <div><b>Payment</b><br>${escapeHtml(b.payment_status || "—")}${b.payment_method ? " • " + escapeHtml(b.payment_method) : ""}</div>
          <div><b>Partner online</b><br>${partner ? (partner.is_online ? "Online" : "Offline") : "—"}</div>
        </div>

        ${status === "pending" ? (() => {
          const options = assignmentOptionsForBooking(b);
          const cancelButton = `<button class="cancel-booking-btn" data-cancel-booking="${escapeHtml(b.id)}">Cancel Booking</button>`;
          if(!options.length){
            return `<div class="notice" style="margin-top:14px">No other eligible online Driver/Rider is currently available for manual assignment.</div><div class="actions">${cancelButton}</div>`;
          }
          return `
            <div class="notice" style="margin-top:14px">
              <b>Admin assignment</b>
              <div class="muted" style="margin:5px 0 10px">Choose another available, matching Driver/Rider. The server will re-check eligibility before assigning.</div>
              <div class="actions">
                <select class="secondary admin-assignment-select" data-booking-id="${escapeHtml(b.id)}">
                  <option value="">Select Driver/Rider</option>
                  ${options.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.full_name || "Unnamed")} • ${escapeHtml(adminVehicleLabel(p.vehicle_type))}</option>`).join("")}
                </select>
                <button class="success admin-assign-btn" data-booking-id="${escapeHtml(b.id)}">Assign / Reassign</button>
              </div>
            </div>
            <div class="actions">${cancelButton}</div>`;
        })() : ""}
      </div>`;
  }).join("");

  list.querySelectorAll(".admin-assign-btn").forEach(button => {
    button.addEventListener("click", async () => {
      const bookingId = button.dataset.bookingId;
      const select = list.querySelector(`.admin-assignment-select[data-booking-id="${CSS.escape(bookingId)}"]`);
      const personId = select?.value || "";
      if(!personId){
        alert("Select a Driver/Rider first.");
        return;
      }
      await assignBookingFromAdmin(bookingId, personId, button);
    });
  });

  list.querySelectorAll("[data-cancel-booking]").forEach(button => {
    button.addEventListener("click", async () => {
      await cancelPendingBookingFromAdmin(button.dataset.cancelBooking, button);
    });
  });
}


let adminPartners = [];
let adminPartnerBookings = [];
let adminPartnerStats = new Map();
let adminPartnerHistory = new Map();

function adminISTDateKey(dateLike){
  const d = new Date(dateLike);
  if(Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(d);
  const get = type => parts.find(x => x.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function adminTodayKey(){
  return adminISTDateKey(new Date());
}

function adminPeriodStartKey(period){
  const today = adminTodayKey();
  if(!today) return "";
  const [y,m,d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if(period === "week"){
    const day = date.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  }else if(period === "month"){
    date.setUTCDate(1);
  }
  return date.toISOString().slice(0,10);
}

function adminBookingInPeriod(booking, period){
  if(period === "all") return true;
  const key = adminISTDateKey(booking?.created_at);
  if(!key) return false;
  const start = adminPeriodStartKey(period);
  return key >= start && key <= adminTodayKey();
}

async function loadAdminPartners(){
  const list = document.getElementById("partnersList");
  if(!list) return;
  list.innerHTML = '<div class="card"><div class="notice">Loading Drivers/Riders...</div></div>';

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
    .in("role", ["driver","rider"])
    .order("full_name", { ascending:true });

  if(error){
    console.error(error);
    list.innerHTML = '<div class="card"><div class="notice error">Could not load Drivers/Riders: ' +
      escapeHtml(error.message || "Unknown error") + '</div></div>';
    return;
  }

  adminPartners = profiles || [];
  const ids = adminPartners.map(p => p.id).filter(Boolean);
  adminPartnerBookings = [];
  adminPartnerStats = new Map();
  adminPartnerHistory = new Map();

  if(ids.length){
    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("id,user_id,driver_id,service,status,pickup_location,destination,created_at,fare_amount")
      .in("driver_id", ids)
      .order("created_at", { ascending:false });

    if(bookingError){
      console.warn("Could not load partner booking history:", bookingError);
    }else{
      const rows = bookings || [];
      adminPartnerBookings = rows.filter(b => ["pending","accepted","in_progress"].includes(String(b.status || "").toLowerCase()));

      for(const id of ids){
        adminPartnerStats.set(id, { completed:0, cancelled:0, totalFare:0, lastRide:null });
        adminPartnerHistory.set(id, []);
      }

      for(const b of rows){
        const id = b.driver_id;
        if(!id || !adminPartnerStats.has(id)) continue;
        const stat = adminPartnerStats.get(id);
        adminPartnerHistory.get(id).push(b);
        const status = String(b.status || "").toLowerCase();
        if(status === "completed") {
          stat.completed += 1;
          const fare = Number(b.fare_amount);
          if(Number.isFinite(fare)) stat.totalFare += fare;
        }else if(status === "cancelled") {
          stat.cancelled += 1;
        }
        if(!stat.lastRide) stat.lastRide = b;
      }
    }
  }

  renderAdminPartners();
}

function renderPartnerSummary(partners, period){
  const box = document.getElementById("partnerSummary");
  if(!box) return;

  const ids = new Set((partners || []).map(p => p.id).filter(Boolean));
  let online = 0;
  let busy = 0;
  let completed = 0;
  let cancelled = 0;
  let totalFare = 0;

  const activeIds = new Set(adminPartnerBookings.map(b => b.driver_id).filter(Boolean));
  for(const p of partners || []){
    if(p.is_online === true) online += 1;
    if(activeIds.has(p.id)) busy += 1;
  }

  for(const b of adminPartnerBookings || []){}
  for(const p of partners || []){
    const historyRows = adminPartnerHistory.get(p.id) || [];
    for(const b of historyRows){
      if(!adminBookingInPeriod(b, period)) continue;
      const status = String(b.status || "").toLowerCase();
      if(status === "completed"){
        completed += 1;
        const fare = Number(b.fare_amount);
        if(Number.isFinite(fare)) totalFare += fare;
      }else if(status === "cancelled") {
        cancelled += 1;
      }
    }
  }

  const offline = Math.max(0, (partners || []).length - online);
  const periodLabel = period === "all" ? "All time" : period === "today" ? "Today" : period === "week" ? "This week" : "This month";
  box.innerHTML = `
    <div class="partner-summary-card"><div class="label">Total partners</div><div class="value">${ids.size}</div></div>
    <div class="partner-summary-card"><div class="label">Online</div><div class="value">${online}</div></div>
    <div class="partner-summary-card"><div class="label">Offline</div><div class="value">${offline}</div></div>
    <div class="partner-summary-card"><div class="label">On active ride</div><div class="value">${busy}</div></div>
    <div class="partner-summary-card"><div class="label">Completed rides · ${escapeHtml(periodLabel)}</div><div class="value">${completed}</div></div>
    <div class="partner-summary-card"><div class="label">Cancelled rides · ${escapeHtml(periodLabel)}</div><div class="value">${cancelled}</div></div>
    <div class="partner-summary-card"><div class="label">Completed fare · ${escapeHtml(periodLabel)}</div><div class="value">₹${totalFare.toFixed(2)}</div></div>
  `;
}

function renderAdminPartners(){
  const list = document.getElementById("partnersList");
  if(!list) return;

  const filter = document.getElementById("partnerStatusFilter")?.value || "all";
  const period = document.getElementById("partnerPeriodFilter")?.value || "all";
  const activeMap = new Map();

  for(const b of adminPartnerBookings){
    if(!activeMap.has(b.driver_id)) activeMap.set(b.driver_id, b);
  }

  const rows = adminPartners.filter(p => {
    const busy = activeMap.has(p.id);
    if(filter === "online") return p.is_online === true;
    if(filter === "offline") return p.is_online !== true;
    if(filter === "busy") return busy;
    if(filter === "available") return p.is_online === true && !busy;
    return true;
  });

  renderPartnerSummary(rows, period);

  if(!rows.length){
    list.innerHTML = '<div class="card"><div class="notice">No Drivers/Riders found for this filter.</div></div>';
    return;
  }

  list.innerHTML = rows.map(p => {
    const active = activeMap.get(p.id);
    const historyRows = adminPartnerHistory.get(p.id) || [];
    const stats = { completed:0, cancelled:0, totalFare:0, lastRide:null };
    for(const b of historyRows){
      if(!adminBookingInPeriod(b, period)) continue;
      const status = String(b.status || "").toLowerCase();
      if(status === "completed"){
        stats.completed += 1;
        const fare = Number(b.fare_amount);
        if(Number.isFinite(fare)) stats.totalFare += fare;
      }else if(status === "cancelled"){
        stats.cancelled += 1;
      }
      if(!stats.lastRide) stats.lastRide = b;
    }
    const roleLabel = p.role === "rider" ? "Bike Rider" : "Driver";
    const vehicle = adminVehicleLabel(p.vehicle_type);
    const online = p.is_online === true;
    const busy = !!active;
    const lastRide = stats.lastRide;
    const lastRideText = lastRide
      ? `${adminVehicleLabel(lastRide.service)} • ${adminStatusLabel(lastRide.status)} • ${formatAdminIST(lastRide.created_at)}`
      : "No rides yet";

    return `
      <div class="partner-card">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(p.full_name || "Unnamed partner")}</h3>
            <div class="muted">${escapeHtml(roleLabel)} • ${escapeHtml(vehicle)}</div>
          </div>
          <span class="partner-badge ${online ? "online-badge" : "offline-badge"}">
            ${busy ? "On active ride" : (online ? "Online" : "Offline")}
          </span>
        </div>

        <div class="notice" style="margin-top:10px">Performance period: <b>${escapeHtml(period === "all" ? "All time" : period === "today" ? "Today" : period === "week" ? "This week" : "This month")}</b></div>

        <div class="status-grid">
          <div><b>Phone</b><br>${escapeHtml(p.phone || "—")}</div>
          <div><b>Vehicle</b><br>${escapeHtml(vehicle)}</div>
          <div><b>Vehicle registration</b><br>${escapeHtml(p.vehicle_registration_number || "—")}</div>
          <div><b>Role</b><br>${escapeHtml(p.role || "—")}</div>
          <div><b>Availability</b><br>${online && !busy ? "Available" : (busy ? "Busy" : "Offline")}</div>
          <div><b>Active booking</b><br>${active ? escapeHtml(active.id) : "None"}</div>
          <div><b>Completed rides</b><br>${escapeHtml(String(stats.completed))}</div>
          <div><b>Cancelled rides</b><br>${escapeHtml(String(stats.cancelled))}</div>
          <div><b>Total completed fare</b><br>₹${escapeHtml(stats.totalFare.toFixed(2))}</div>
          <div><b>Last ride</b><br>${escapeHtml(lastRideText)}</div>
        </div>

        ${active ? `
          <div class="notice" style="margin-top:14px">
            <b>Current ride:</b> ${escapeHtml(adminVehicleLabel(active.service))} •
            ${escapeHtml(adminStatusLabel(active.status))}<br>
            <span class="muted">${escapeHtml(active.pickup_location || "—")} → ${escapeHtml(active.destination || "—")}</span>
          </div>
        ` : ""}

        <div class="partner-actions">
          ${online && !busy
            ? `<button class="danger-btn" data-force-offline="${escapeHtml(p.id)}">Set Offline</button>`
            : `<button class="secondary muted-btn" disabled>${busy ? "On active ride" : "Already Offline"}</button>`
          }
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-force-offline]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.forceOffline;
      if (!id) return;
      if (!confirm("Set this Driver/Rider offline? This will prevent new automatic assignments.")) return;

      btn.disabled = true;
      btn.textContent = "Updating...";

      const { error } = await supabase.rpc("admin_set_partner_offline", {
        p_person_id: id
      });

      if (error) {
        alert(error.message || "Could not set partner offline.");
        btn.disabled = false;
        btn.textContent = "Set Offline";
        return;
      }

      await loadAdminPartners();
      await loadDashboardOverview();
    });
  });
}

let adminAnalyticsBookings = [];

function analyticsISTDateKey(dateLike){
  if(!dateLike) return "";
  const d = new Date(dateLike);
  if(Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"
  }).format(d);
}

function analyticsPeriodStartKey(period){
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(now).reduce((o,p)=>{o[p.type]=p.value;return o;},{});
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  const base = new Date(Date.UTC(y, m-1, d));
  if(period === "today") return analyticsISTDateKey(base.toISOString());
  if(period === "week"){
    const day = base.getUTCDay();
    base.setUTCDate(base.getUTCDate() - ((day + 6) % 7));
    return analyticsISTDateKey(base.toISOString());
  }
  if(period === "month") return `${y}-${String(m).padStart(2,"0")}-01`;
  return "";
}

function analyticsBookingInPeriod(booking, period){
  if(period === "all") return true;
  const key = analyticsISTDateKey(booking.created_at || booking.booking_date);
  const start = analyticsPeriodStartKey(period);
  return !!key && !!start && key >= start;
}

async function loadAdminAnalytics(){
  const msg = document.getElementById("analyticsMessage");
  const summary = document.getElementById("analyticsSummary");
  const services = document.getElementById("analyticsServices");
  const payments = document.getElementById("analyticsPayments");
  if(!summary) return;

  summary.innerHTML = `<div class="notice">Loading analytics...</div>`;
  const {data,error} = await supabase
    .from("bookings")
    .select("id,status,service,fare_amount,payment_status,created_at")
    .order("created_at", {ascending:false});

  if(error){
    showMessage(msg, error.message || "Could not load analytics.");
    summary.innerHTML = "";
    return;
  }

  adminAnalyticsBookings = data || [];
  renderAdminAnalytics();
}

function renderAdminAnalytics(){
  const period = document.getElementById("analyticsPeriodFilter")?.value || "all";
  const rows = adminAnalyticsBookings.filter(b => analyticsBookingInPeriod(b, period));
  const norm = b => String(b.status || "").toLowerCase();
  const completed = rows.filter(b => norm(b) === "completed");
  const cancelled = rows.filter(b => norm(b) === "cancelled");
  const active = rows.filter(b => ["accepted","in_progress"].includes(norm(b)));
  const pending = rows.filter(b => norm(b) === "pending");
  const fare = completed.reduce((sum,b)=>{
    const n=Number(b.fare_amount); return sum + (Number.isFinite(n)?n:0);
  },0);

  const summary = document.getElementById("analyticsSummary");
  summary.innerHTML = [
    ["Total rides", rows.length],
    ["Completed", completed.length],
    ["Cancelled", cancelled.length],
    ["Active", active.length],
    ["Pending", pending.length],
    ["Completed fare", "₹"+fare.toFixed(2)]
  ].map(([label,value])=>`<div class="overview-stat"><b>${escapeHtml(label)}</b><div class="overview-value">${escapeHtml(value)}</div></div>`).join("");

  const serviceMap = {};
  for(const b of rows){
    const service = String(b.service || "unknown").toLowerCase();
    serviceMap[service] ||= {rides:0, completed:0, cancelled:0, fare:0};
    serviceMap[service].rides++;
    if(norm(b)==="completed"){
      serviceMap[service].completed++;
      const n=Number(b.fare_amount); if(Number.isFinite(n)) serviceMap[service].fare += n;
    }
    if(norm(b)==="cancelled") serviceMap[service].cancelled++;
  }
  const serviceEntries = Object.entries(serviceMap).sort((a,b)=>b[1].rides-a[1].rides);
  document.getElementById("analyticsServices").innerHTML = serviceEntries.length ? serviceEntries.map(([service,v])=>`
    <div class="app-row"><div class="row-top"><div><h3>${escapeHtml(service === "auto" ? "Auto" : service === "bike" ? "Bike" : service === "car" ? "Car" : service)}</h3><div class="muted">${v.rides} ride${v.rides===1?"":"s"}</div></div><span class="pill">₹${v.fare.toFixed(2)} completed fare</span></div><div class="meta"><div><b>Completed</b>${v.completed}</div><div><b>Cancelled</b>${v.cancelled}</div><div><b>Completed fare</b>₹${v.fare.toFixed(2)}</div></div></div>`).join("") : `<div class="notice">No rides found for this period.</div>`;

  const paid = rows.filter(b => norm(b)==="completed" && String(b.payment_status||"").toLowerCase()==="paid").length;
  const unpaidCompleted = completed.filter(b => String(b.payment_status||"").toLowerCase() !== "paid").length;
  document.getElementById("analyticsPayments").innerHTML = `<div class="overview-grid"><div class="overview-stat"><b>Completed marked paid</b><div class="overview-value">${paid}</div></div><div class="overview-stat"><b>Completed not marked paid</b><div class="overview-value">${unpaidCompleted}</div></div></div>`;
}

let adminPayoutSummary = [];

function formatMoney(value){
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : "₹0.00";
}

function payoutVehicleLabel(vehicle){
  const v = String(vehicle || "").toLowerCase();
  if(v === "bike") return "Bike Rider";
  if(v === "auto") return "Auto Driver";
  if(v === "car") return "Car Driver";
  return "Driver/Rider";
}

async function loadAdminPayouts(){
  const list = document.getElementById("payoutsList");
  const summary = document.getElementById("payoutSummary");
  if(!list || !summary) return;

  list.innerHTML = '<div class="card"><div class="notice">Loading payout data...</div></div>';
  showMessage(document.getElementById("payoutsMessage"), "");

  const { data, error } = await supabase.rpc("admin_get_payout_summary");
  if(error){
    console.error("Admin payouts error:", error);
    summary.innerHTML = "";
    list.innerHTML = `<div class="card"><div class="notice error">Could not load payouts: ${escapeHtml(error.message || "Unknown error")}</div></div>`;
    return;
  }

  adminPayoutSummary = Array.isArray(data) ? data : [];
  const pendingPartners = adminPayoutSummary.filter(p => Number(p.pending_earnings) > 0);
  const pendingAmount = pendingPartners.reduce((sum,p) => sum + Number(p.pending_earnings || 0), 0);
  const paidAmount = adminPayoutSummary.reduce((sum,p) => sum + Number(p.paid_earnings || 0), 0);
  const pendingRides = pendingPartners.reduce((sum,p) => sum + Number(p.pending_rides || 0), 0);

  summary.innerHTML = `
    <div class="overview-stat"><b>Partners with pending payout</b><div class="overview-value">${pendingPartners.length}</div></div>
    <div class="overview-stat"><b>Pending payout</b><div class="overview-value">${formatMoney(pendingAmount)}</div></div>
    <div class="overview-stat"><b>Pending rides</b><div class="overview-value">${pendingRides}</div></div>
    <div class="overview-stat"><b>Total paid earnings</b><div class="overview-value">${formatMoney(paidAmount)}</div></div>
  `;

  if(!adminPayoutSummary.length){
    list.innerHTML = '<div class="card"><div class="notice">No partner earnings have been recorded yet.</div></div>';
    return;
  }

  list.innerHTML = adminPayoutSummary.map(p => {
    const pending = Number(p.pending_earnings || 0);
    const paid = Number(p.paid_earnings || 0);
    const statusClass = pending > 0 ? "pending" : "paid";
    return `
      <div class="payout-card ${statusClass}" data-payout-partner="${escapeHtml(p.partner_id)}">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(p.partner_name || "Driver/Rider")}</h3>
            <div class="muted">${escapeHtml(payoutVehicleLabel(p.vehicle_type))}</div>
          </div>
          <span class="pill">${pending > 0 ? "Pending" : "Paid"}</span>
        </div>
        <div class="meta">
          <div><b>Phone</b>${escapeHtml(p.partner_phone || "—")}</div>
          <div><b>Pending rides</b>${Number(p.pending_rides || 0)}</div>
          <div><b>Pending payout</b>${formatMoney(pending)}</div>
          <div><b>Paid earnings</b>${formatMoney(paid)}</div>
          <div><b>Last paid</b>${escapeHtml(formatAdminIST(p.last_paid_at))}</div>
        </div>
        <div class="payout-actions">
          ${pending > 0 ? `<button class="success" data-payout-pay="${escapeHtml(p.partner_id)}">Mark Pending Earnings Paid</button>` : ""}
          <button class="secondary" data-payout-ledger="${escapeHtml(p.partner_id)}">View Earnings</button>
        </div>
        <div id="payoutLedger_${escapeHtml(p.partner_id)}" class="hidden"></div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-payout-pay]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const partnerId = btn.dataset.payoutPay;
      const partner = adminPayoutSummary.find(p => p.partner_id === partnerId);
      if(!partner) return;
      const amount = formatMoney(partner.pending_earnings);
      const reference = window.prompt(`Enter the bank/UPI payout reference for ${partner.partner_name || "this partner"}.\nAmount: ${amount}`);
      if(reference === null) return;
      const trimmed = reference.trim();
      if(!trimmed){
        showMessage(document.getElementById("payoutsMessage"), "Payout reference is required.");
        return;
      }
      if(!window.confirm(`Confirm payout of ${amount} to ${partner.partner_name || "this partner"}?\nReference: ${trimmed}`)) return;

      btn.disabled = true;
      btn.textContent = "Processing...";
      const { data: result, error: payoutError } = await supabase.rpc("admin_process_partner_payout", {
        p_partner: partnerId,
        p_reference: trimmed
      });
      if(payoutError){
        console.error("Payout processing error:", payoutError);
        showMessage(
          document.getElementById("payoutsMessage"),
          `Payout failed: ${payoutError.message || "Could not process payout."}`
        );
        btn.disabled = false;
        btn.textContent = "Mark Pending Earnings Paid";
        return;
      }

      const row = result && typeof result === "object" ? result : null;
      if(!row || row.paid_amount == null){
        console.error("Unexpected payout response:", result);
        showMessage(
          document.getElementById("payoutsMessage"),
          "Payout failed: the server returned an unexpected response."
        );
        btn.disabled = false;
        btn.textContent = "Mark Pending Earnings Paid";
        return;
      }

      showMessage(
        document.getElementById("payoutsMessage"),
        `Payout recorded: ${formatMoney(row.paid_amount)} for ${row.paid_rides || 0} ride(s). Reference: ${row.payout_reference || trimmed}.`,
        "ok"
      );
      await loadAdminPayouts();
    });
  });

  list.querySelectorAll("[data-payout-ledger]").forEach(btn => {
    btn.addEventListener("click", () => toggleAdminPayoutLedger(btn.dataset.payoutLedger));
  });
}

async function toggleAdminPayoutLedger(partnerId){
  const target = document.getElementById(`payoutLedger_${partnerId}`);
  if(!target) return;
  if(!target.classList.contains("hidden")){
    target.classList.add("hidden");
    return;
  }
  target.classList.remove("hidden");
  target.innerHTML = '<div class="notice">Loading earnings...</div>';

  const { data, error } = await supabase.rpc("admin_get_payout_ledger", { p_partner_id: partnerId });
  if(error){
    target.innerHTML = `<div class="notice error">Could not load earnings: ${escapeHtml(error.message || "Unknown error")}</div>`;
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  if(!rows.length){
    target.innerHTML = '<div class="notice">No earnings records found.</div>';
    return;
  }
  target.innerHTML = rows.map(r => `
    <div class="history-ride-row">
      <div class="row-top"><strong>${formatMoney(r.partner_earnings)}</strong><span class="pill">${escapeHtml(r.payout_status || "pending")}</span></div>
      <div class="muted small">Gross ${formatMoney(r.gross_fare)} · Fee ${formatMoney(r.platform_fee)} · ${escapeHtml(r.payment_method || "—")}</div>
      <div class="muted small">Earned ${escapeHtml(formatAdminIST(r.earned_at))}${r.paid_at ? ` · Paid ${escapeHtml(formatAdminIST(r.paid_at))}` : ""}</div>
      ${r.payout_id ? `<div class="payout-ref">Payout reference: ${escapeHtml(r.payout_id)}</div>` : ""}
    </div>
  `).join("");
}

function setAdminTab(tab){
  const applications = document.getElementById("applicationsSection");
  const bookings = document.getElementById("bookingsSection");
  const partners = document.getElementById("partnersSection");
  const analytics = document.getElementById("analyticsSection");
  const historyRequests = document.getElementById("historyRequestsSection");
  const payouts = document.getElementById("payoutsSection");
  const applicationsTab = document.getElementById("applicationsTab");
  const bookingsTab = document.getElementById("bookingsTab");
  const partnersTab = document.getElementById("partnersTab");
  const analyticsTab = document.getElementById("analyticsTab");
  const historyRequestsTab = document.getElementById("historyRequestsTab");
  const payoutsTab = document.getElementById("payoutsTab");

  const showBookings = tab === "bookings";
  const showPartners = tab === "partners";
  const showAnalytics = tab === "analytics";
  const showHistoryRequests = tab === "history_requests";
  const showPayouts = tab === "payouts";

  applications?.classList.toggle("hidden", showBookings || showPartners || showAnalytics || showHistoryRequests || showPayouts);
  bookings?.classList.toggle("hidden", !showBookings);
  partners?.classList.toggle("hidden", !showPartners);
  analytics?.classList.toggle("hidden", !showAnalytics);
  historyRequests?.classList.toggle("hidden", !showHistoryRequests);
  payouts?.classList.toggle("hidden", !showPayouts);

  applicationsTab?.classList.toggle("active", !showBookings && !showPartners && !showAnalytics && !showHistoryRequests && !showPayouts);
  bookingsTab?.classList.toggle("active", showBookings);
  partnersTab?.classList.toggle("active", showPartners);
  analyticsTab?.classList.toggle("active", showAnalytics);
  historyRequestsTab?.classList.toggle("active", showHistoryRequests);
  payoutsTab?.classList.toggle("active", showPayouts);

  if(showBookings) void loadAdminBookings();
  if(showPartners) void loadAdminPartners();
  if(showAnalytics) void loadAdminAnalytics();
  if(showHistoryRequests) void loadOlderHistoryRequests();
  if(showPayouts) void loadAdminPayouts();
}

async function loadApplications() {
  showMessage(dashboardMessage, "");
  applicationsList.innerHTML = `<div class="card muted">Loading applications...</div>`;

  const { data, error } = await supabase
    .from("driver_rider_applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    applicationsData = [];
    applicationsList.innerHTML = "";
    showMessage(dashboardMessage, error.message);
    return;
  }

  applicationsData = data || [];
  updateApplicationSummary(applicationsData);
  renderApplications();
}

function applicationStatus(value) {
  return String(value || "pending").toLowerCase();
}

function applicationAge(createdAt) {
  if (!createdAt) return "";
  const ms = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function updateApplicationSummary(data) {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  (data || []).forEach(app => {
    const status = applicationStatus(app.status);
    if (counts[status] !== undefined) counts[status]++;
  });
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set("applicationTotal", data?.length || 0);
  set("applicationPending", counts.pending);
  set("applicationApproved", counts.approved);
  set("applicationRejected", counts.rejected);
}

function renderApplications() {
  const statusFilter = document.getElementById("applicationStatusFilter")?.value || "all";
  const search = (document.getElementById("applicationSearch")?.value || "").trim().toLowerCase();

  const filtered = applicationsData.filter(app => {
    const status = applicationStatus(app.status);
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (!search) return true;
    const haystack = [
      app.full_name, app.phone, app.email, app.vehicle_registration_number,
      app.license_number, app.requested_role, app.vehicle_type, app.id
    ].map(v => String(v || "").toLowerCase()).join(" ");
    return haystack.includes(search);
  });

  if (!filtered.length) {
    applicationsList.innerHTML = `<div class="card"><h3>No applications found</h3><p class="muted">Try another status or search term.</p></div>`;
    return;
  }

  applicationsList.innerHTML = filtered.map(app => {
    const status = applicationStatus(app.status);
    const pending = status === "pending";
    return `
      <div class="app-row ${pending ? "application-pending" : ""}">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(app.full_name || "Unnamed applicant")}</h3>
            <div class="muted">${escapeHtml(vehicleLabel(app.vehicle_type, app.requested_role))}</div>
          </div>
          <div style="text-align:right">
            <span class="application-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
            ${pending ? `<div class="application-age">${escapeHtml(applicationAge(app.created_at))}</div>` : ""}
          </div>
        </div>
        ${pending ? `<div class="application-pending-banner">⚠️ Pending Admin review</div>` : ""}
        <div class="meta">
          <div><b>Phone</b>${escapeHtml(app.phone || "—")}</div>
          <div><b>Email</b>${escapeHtml(app.email || "—")}</div>
          <div><b>Vehicle</b>${escapeHtml(vehicleLabel(app.vehicle_type, app.requested_role))}</div>
          <div><b>Vehicle registration</b>${escapeHtml(app.vehicle_registration_number || "—")}</div>
          <div><b>Licence Number</b>${escapeHtml(app.license_number || "—")}</div>
          <div><b>Submitted</b>${escapeHtml(formatAdminIST(app.created_at))}</div>
          <div><b>Application ID</b>${escapeHtml(app.id)}</div>
        </div>
        <div class="actions">
          <button class="secondary" data-review="${escapeHtml(app.id)}">${pending ? "Review Application" : "View Application"}</button>
        </div>
      </div>
    `;
  }).join("");

  applicationsList.querySelectorAll("[data-review]").forEach(btn => {
    btn.addEventListener("click", () => openApplication(btn.dataset.review, applicationsData));
  });
}

function formatDate(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

async function openApplication(id, list) {
  currentApplication = list.find(x => x.id === id);
  if (!currentApplication) return;

  dashboardView.classList.add("hidden");
  detailView.classList.remove("hidden");
  showMessage(detailMessage, "");
  detailContent.innerHTML = `<p class="muted">Loading application...</p>`;

  let documentHtml = `<div class="notice">No licence document path was stored.</div>`;

  if (currentApplication.license_file_path) {
    const { data, error } = await supabase.storage
      .from("driver-documents")
      .createSignedUrl(currentApplication.license_file_path, 600);

    if (!error && data?.signedUrl) {
      const path = currentApplication.license_file_path.toLowerCase();
      if (path.endsWith(".jpg") || path.endsWith(".jpeg") || path.endsWith(".png") || path.endsWith(".webp")) {
        documentHtml = `
          <h3>Licence Document</h3>
          <img class="doc" src="${escapeHtml(data.signedUrl)}" alt="Licence document">
        `;
      } else {
        documentHtml = `
          <h3>Licence Document</h3>
          <div class="pdfbox">
            <p>Licence document is available as a PDF/file.</p>
            <a href="${escapeHtml(data.signedUrl)}" target="_blank" rel="noopener">Open Licence Document</a>
          </div>
        `;
      }
    } else {
      documentHtml = `<div class="notice error">Could not open the private licence document: ${escapeHtml(error?.message || "unknown error")}</div>`;
    }
  }

  const pending = currentApplication.status === "pending";

  detailContent.innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="meta">
          <div><b>Name</b>${escapeHtml(currentApplication.full_name)}</div>
          <div><b>Email</b>${escapeHtml(currentApplication.email || "—")}</div>
          <div><b>Phone</b>${escapeHtml(currentApplication.phone)}</div>
          <div><b>Requested Service</b>${escapeHtml(vehicleLabel(currentApplication.vehicle_type, currentApplication.requested_role))}</div>
          <div><b>Vehicle Registration</b>${escapeHtml(currentApplication.vehicle_registration_number || "—")}</div>
          <div><b>Licence Number</b>${escapeHtml(currentApplication.license_number || "—")}</div>
          <div><b>Status</b>${escapeHtml(currentApplication.status)}</div>
          <div><b>Submitted</b>${escapeHtml(formatAdminIST(currentApplication.updated_at || currentApplication.created_at))}</div>
        </div>
      </div>
      <div>${documentHtml}</div>
    </div>

    ${currentApplication.rejection_reason ? `
      <div class="notice error"><b>Rejection reason:</b> ${escapeHtml(currentApplication.rejection_reason)}</div>
    ` : ""}

    ${pending ? `
      <div class="card" style="padding:16px;margin-top:18px">
        <h3>Decision</h3>
        <p class="muted">Approve to promote the applicant's profile to ${escapeHtml(currentApplication.requested_role)} with ${escapeHtml(currentApplication.vehicle_type)}. Reject to keep the account as a customer.</p>
        <label for="rejectionReason">Rejection reason (only needed for Reject)</label>
        <textarea id="rejectionReason" placeholder="Explain why the application is rejected"></textarea>
        <div class="actions">
          <button id="approveBtn" class="success">Approve Application</button>
          <button id="rejectBtn" class="danger">Reject Application</button>
        </div>
      </div>
    ` : `<div class="notice">This application has already been reviewed.</div>`}
  `;

  if (pending) {
    $("approveBtn").addEventListener("click", () => reviewApplication(true));
    $("rejectBtn").addEventListener("click", () => reviewApplication(false));
  }
}

async function reviewApplication(approved) {
  if (!currentApplication) return;

  if (!approved) {
    const reason = $("rejectionReason")?.value.trim() || "";
    if (!reason) {
      showMessage(detailMessage, "Please enter a rejection reason.");
      return;
    }
  }

  const approveBtn = $("approveBtn");
  const rejectBtn = $("rejectBtn");
  if (approveBtn) approveBtn.disabled = true;
  if (rejectBtn) rejectBtn.disabled = true;

  showMessage(detailMessage, approved ? "Approving application..." : "Rejecting application...", "ok");

  const { error } = await supabase.rpc("review_driver_rider_application", {
    p_application_id: currentApplication.id,
    p_approved: approved,
    p_rejection_reason: approved ? null : $("rejectionReason").value.trim()
  });

  if (error) {
    showMessage(detailMessage, error.message);
    if (approveBtn) approveBtn.disabled = false;
    if (rejectBtn) rejectBtn.disabled = false;
    return;
  }

  showMessage(detailMessage, approved
    ? "Application approved successfully."
    : "Application rejected successfully.", "ok");

  await new Promise(r => setTimeout(r, 500));
  await loadApplications();
  detailView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
}

document.getElementById("applicationsTab")?.addEventListener("click", () => setAdminTab("applications"));
document.getElementById("bookingsTab")?.addEventListener("click", () => setAdminTab("bookings"));
document.getElementById("partnersTab")?.addEventListener("click", () => setAdminTab("partners"));
document.getElementById("analyticsTab")?.addEventListener("click", () => setAdminTab("analytics"));
document.getElementById("historyRequestsTab")?.addEventListener("click", () => setAdminTab("history_requests"));
document.getElementById("payoutsTab")?.addEventListener("click", () => setAdminTab("payouts"));
document.getElementById("payoutsRefreshBtn")?.addEventListener("click", () => loadAdminPayouts());
document.getElementById("historyRequestStatusFilter")?.addEventListener("change", renderOlderHistoryRequests);
document.getElementById("historyRequestsRefreshBtn")?.addEventListener("click", () => loadOlderHistoryRequests());
document.getElementById("bookingStatusFilter")?.addEventListener("change", renderAdminBookings);
document.getElementById("applicationStatusFilter")?.addEventListener("change", renderApplications);
document.getElementById("applicationSearch")?.addEventListener("input", renderApplications);
document.getElementById("partnerStatusFilter")?.addEventListener("change", renderAdminPartners);
document.getElementById("partnerPeriodFilter")?.addEventListener("change", renderAdminPartners);
document.getElementById("analyticsPeriodFilter")?.addEventListener("change", renderAdminAnalytics);

loginBtn.addEventListener("click", async () => {
  showMessage(loginMessage, "");
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    showMessage(loginMessage, "Enter your Admin email and password.");
    return;
  }

  loginBtn.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    await requireAdmin();
    await showDashboard();
  } catch (error) {
    showMessage(loginMessage, error.message || "Admin login failed.");
    await supabase.auth.signOut();
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

refreshBtn.addEventListener("click", async () => {
  await loadDashboardOverview();
  await loadActionCenter();
  const bookingsVisible = !$("bookingsSection")?.classList.contains("hidden");
  const partnersVisible = !$("partnersSection")?.classList.contains("hidden");
  const payoutsVisible = !$("payoutsSection")?.classList.contains("hidden");
  if (payoutsVisible) return loadAdminPayouts();
  if (bookingsVisible) return loadAdminBookings();
  if (partnersVisible) return loadAdminPartners();
  return loadApplications();
});

backBtn.addEventListener("click", async () => {
  detailView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  await loadApplications();
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session) {
    showLogin();
    return;
  }
  try {
    if (await requireAdmin()) await showDashboard();
  } catch (error) {
    showMessage(loginMessage, error.message || "Admin access required.");
    showLogin();
  }
});

(async function init() {
  try {
    const session = await getSession();
    if (session?.user && await requireAdmin()) await showDashboard();
    else showLogin();
  } catch (error) {
    showLogin();
    showMessage(loginMessage, error.message || "Unable to initialize Admin Dashboard.");
  }
})();


