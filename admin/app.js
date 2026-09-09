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

async function showDashboard() {
  loginView.classList.add("hidden");
  detailView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  await loadApplications();
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

  renderAdminBookings();
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

function renderAdminBookings(){
  const list = document.getElementById("bookingsList");
  if(!list) return;

  const filter = document.getElementById("bookingStatusFilter")?.value || "all";
  const rows = filter === "all"
    ? adminBookings
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

    return `
      <div class="booking-card">
        <div class="row-top">
          <div>
            <h3>${escapeHtml(service)} Ride</h3>
            <div class="muted small">Booking ID: ${escapeHtml(b.id || "—")}</div>
          </div>
          <span class="pill booking-status">${escapeHtml(adminStatusLabel(status))}</span>
        </div>

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
          if(!options.length){
            return `<div class="notice" style="margin-top:14px">No other eligible online Driver/Rider is currently available for manual assignment.</div>`;
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
            </div>`;
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
}


let adminPartners = [];
let adminPartnerBookings = [];

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

  if(ids.length){
    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("id,user_id,driver_id,service,status,pickup_location,destination,created_at,fare_amount")
      .in("driver_id", ids)
      .in("status", ["pending","accepted","in_progress"])
      .order("created_at", { ascending:false });

    if(bookingError){
      console.warn("Could not load active partner bookings:", bookingError);
    }else{
      adminPartnerBookings = bookings || [];
    }
  }

  renderAdminPartners();
}

function renderAdminPartners(){
  const list = document.getElementById("partnersList");
  if(!list) return;

  const filter = document.getElementById("partnerStatusFilter")?.value || "all";
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

  if(!rows.length){
    list.innerHTML = '<div class="card"><div class="notice">No Drivers/Riders found for this filter.</div></div>';
    return;
  }

  list.innerHTML = rows.map(p => {
    const active = activeMap.get(p.id);
    const roleLabel = p.role === "rider" ? "Bike Rider" : "Driver";
    const vehicle = adminVehicleLabel(p.vehicle_type);
    const online = p.is_online === true;
    const busy = !!active;

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

        <div class="status-grid">
          <div><b>Phone</b><br>${escapeHtml(p.phone || "—")}</div>
          <div><b>Vehicle</b><br>${escapeHtml(vehicle)}</div>
          <div><b>Vehicle registration</b><br>${escapeHtml(p.vehicle_registration_number || "—")}</div>
          <div><b>Role</b><br>${escapeHtml(p.role || "—")}</div>
          <div><b>Availability</b><br>${online && !busy ? "Available" : (busy ? "Busy" : "Offline")}</div>
          <div><b>Active booking</b><br>${active ? escapeHtml(active.id) : "None"}</div>
        </div>

        ${active ? `
          <div class="notice" style="margin-top:14px">
            <b>Current ride:</b> ${escapeHtml(adminVehicleLabel(active.service))} •
            ${escapeHtml(adminStatusLabel(active.status))}<br>
            <span class="muted">${escapeHtml(active.pickup_location || "—")} → ${escapeHtml(active.destination || "—")}</span>
          </div>
        ` : ""}
      </div>`;
  }).join("");
}

function setAdminTab(tab){
  const applications = document.getElementById("applicationsSection");
  const bookings = document.getElementById("bookingsSection");
  const partners = document.getElementById("partnersSection");
  const applicationsTab = document.getElementById("applicationsTab");
  const bookingsTab = document.getElementById("bookingsTab");
  const partnersTab = document.getElementById("partnersTab");

  const showBookings = tab === "bookings";
  const showPartners = tab === "partners";

  applications?.classList.toggle("hidden", showBookings || showPartners);
  bookings?.classList.toggle("hidden", !showBookings);
  partners?.classList.toggle("hidden", !showPartners);

  applicationsTab?.classList.toggle("active", !showBookings && !showPartners);
  bookingsTab?.classList.toggle("active", showBookings);
  partnersTab?.classList.toggle("active", showPartners);

  if(showBookings) void loadAdminBookings();
  if(showPartners) void loadAdminPartners();
}

async function loadApplications() {
  showMessage(dashboardMessage, "");
  applicationsList.innerHTML = `<div class="card muted">Loading applications...</div>`;

  const { data, error } = await supabase
    .from("driver_rider_applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    applicationsList.innerHTML = "";
    showMessage(dashboardMessage, error.message);
    return;
  }

  if (!data?.length) {
    applicationsList.innerHTML = `<div class="card"><h3>No applications</h3><p class="muted">There are currently no Driver/Rider applications.</p></div>`;
    return;
  }

  applicationsList.innerHTML = data.map(app => `
    <div class="app-row">
      <div class="row-top">
        <div>
          <h3>${escapeHtml(app.full_name || "Unnamed applicant")}</h3>
          <div class="muted">${escapeHtml(vehicleLabel(app.vehicle_type, app.requested_role))}</div>
        </div>
        <span class="pill">${escapeHtml(app.status)}</span>
      </div>
      <div class="meta">
        <div><b>Phone</b>${escapeHtml(app.phone || "—")}</div>
        <div><b>Licence Number</b>${escapeHtml(app.license_number || "—")}</div>
        <div><b>Created</b>${escapeHtml(formatAdminIST(app.created_at))}</div>
        <div><b>Application ID</b>${escapeHtml(app.id)}</div>
      </div>
      <div class="actions">
        <button class="secondary" data-review="${escapeHtml(app.id)}">View / Review</button>
      </div>
    </div>
  `).join("");

  applicationsList.querySelectorAll("[data-review]").forEach(btn => {
    btn.addEventListener("click", () => openApplication(btn.dataset.review, data));
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
document.getElementById("bookingStatusFilter")?.addEventListener("change", renderAdminBookings);
document.getElementById("partnerStatusFilter")?.addEventListener("change", renderAdminPartners);

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

refreshBtn.addEventListener("click", () => {
  const bookingsVisible = !$("bookingsSection")?.classList.contains("hidden");
  const partnersVisible = !$("partnersSection")?.classList.contains("hidden");
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


