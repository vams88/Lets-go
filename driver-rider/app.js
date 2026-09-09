import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const screens = ["startScreen","registerScreen","loginScreen","verificationScreen","approvedScreen","dashboardScreen"];

let selectedVehicle = "";
let currentUser = null;
let currentApplication = null;
let dashboardBookings = [];
let bookingChannel = null;
let liveLocationWatchId = null;
let liveLocationBookingId = null;

const vehicleInfo = {
  bike: { label: "Bike", role: "rider", roleLabel: "Rider", icon: "🏍️" },
  auto: { label: "Auto", role: "driver", roleLabel: "Driver", icon: "🛺" },
  car: { label: "Car", role: "driver", roleLabel: "Driver", icon: "🚕" }
};

function showScreen(id){
  screens.forEach(x => $(x)?.classList.toggle("hidden", x !== id));
  window.scrollTo(0,0);
}

function setStatus(el, message, type=""){
  if(!el) return;
  el.textContent = message || "";
  el.className = "status" + (message ? "" : " hidden") + (type ? " " + type : "");
}

function normalizeVehicle(v){
  v = String(v || "").trim().toLowerCase();
  return ["bike","auto","car"].includes(v) ? v : "";
}

function statusLabel(status){
  return ({
    awaiting_documents: "Awaiting Documents",
    pending: "Pending Admin Verification",
    approved: "Approved",
    rejected: "Rejected"
  })[status] || "Unknown";
}

async function loadApplication(userId = currentUser?.id){
  if(!userId) return null;
  const { data, error } = await supabase
    .from("driver_rider_applications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if(error){
    console.error(error);
    throw error;
  }
  currentApplication = data || null;
  return currentApplication;
}

async function ensureProfile(user, fullName, phone, vehicle){
  // The profile row is created/managed separately. Driver/Rider registration
  // must not use upsert here because PostgREST evaluates INSERT RLS for an
  // upsert, and applicants must not be able to create/assign driver roles.
  // The application table is the source of truth until Admin approval.
  return vehicleInfo[vehicle] || null;
}

async function createOrGetApplication(user, fullName, phone, vehicle){
  const info = vehicleInfo[vehicle];
  let app = await loadApplication(user.id);
  if(app) return app;

  const { data, error } = await supabase
    .from("driver_rider_applications")
    .insert({
      user_id: user.id,
      requested_role: info.role,
      vehicle_type: vehicle,
      full_name: fullName,
      phone,
      status: "awaiting_documents"
    })
    .select("*")
    .single();

  if(error) throw error;
  currentApplication = data;
  return data;
}

async function submitLicence(application, file, licenseNumber){
  if(!file) throw new Error("Upload your driving licence document.");
  if(!licenseNumber.trim()) throw new Error("Enter your driving licence number.");

  const allowed = ["image/jpeg","image/png","application/pdf"];
  if(!allowed.includes(file.type)) throw new Error("Use JPG, PNG or PDF for the driving licence.");
  if(file.size > 5 * 1024 * 1024) throw new Error("Driving licence file must be 5 MB or smaller.");

  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
  const path = `${currentUser.id}/licence-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("driver-documents")
    .upload(path, file, { contentType:file.type, upsert:false });

  if(uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("driver_rider_applications")
    .update({
      license_number: licenseNumber.trim(),
      license_file_path: path,
      status: "pending",
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", application.id)
    .eq("user_id", currentUser.id)
    .select("*")
    .single();

  if(error){
    await supabase.storage.from("driver-documents").remove([path]);
    throw error;
  }

  currentApplication = data;
  return data;
}

function renderVerification(app){
  const info = vehicleInfo[normalizeVehicle(app?.vehicle_type)] || {};
  let html = `
    <div class="row"><span>Service</span><strong>${info.icon || ""} ${info.label || "—"} ${info.roleLabel || ""}</strong></div>
    <div class="row"><span>Status</span><span class="pill">${statusLabel(app?.status)}</span></div>
    <div class="row"><span>Licence</span><strong>${app?.license_number ? "Submitted" : "Not submitted"}</strong></div>
  `;

  if(app?.status === "pending"){
    html += `<div class="status">Your registration and driving licence are waiting for Admin verification. You cannot go online yet.</div>`;
  } else if(app?.status === "rejected"){
    html += `<div class="status bad"><strong>Reason:</strong> ${app.rejection_reason || "Please resubmit your documents."}</div>`;
    html += `<button id="resubmitBtn" class="btn">Resubmit Licence</button>`;
  } else if(app?.status === "awaiting_documents"){
    html += `<div class="status">Your account exists, but your driving licence still needs to be submitted.</div>`;
    html += `<button id="resubmitBtn" class="btn">Submit Licence</button>`;
  } else if(app?.status === "approved"){
    html += `<div class="status ok">Admin has approved your registration.</div>`;
  }

  $("verificationContent").innerHTML = html;
  $("resubmitBtn")?.addEventListener("click", () => {
    selectedVehicle = normalizeVehicle(app.vehicle_type);
    $("selectedService").textContent = `${vehicleInfo[selectedVehicle].icon} ${vehicleInfo[selectedVehicle].label} ${vehicleInfo[selectedVehicle].roleLabel}`;
    showScreen("registerScreen");
    $("fullName").value = app.full_name || currentUser?.user_metadata?.full_name || "";
    $("phone").value = app.phone || currentUser?.user_metadata?.phone || "";
    $("email").value = currentUser?.email || "";
    $("licenseNumber").value = app.license_number || "";
    $("password").value = "";
    setStatus($("registerStatus"), "");
  });
}

async function routeUser(user){
  currentUser = user;
  const app = await loadApplication(user.id);

  if(!app){
    const notice = $("existingAccountNotice");
    if(notice){
      notice.textContent = "Your email is confirmed. Choose Bike, Auto or Car below to complete your Driver/Rider registration.";
      notice.className = "status ok";
    }
    showScreen("startScreen");
    return;
  }

  if(app.status === "approved"){
    const info = vehicleInfo[normalizeVehicle(app.vehicle_type)] || {};
    $("approvedText").textContent = `You are approved as a ${info.roleLabel || ""} for ${info.label || ""}.`;
    showScreen("approvedScreen");
    return;
  }

  renderVerification(app);
  showScreen("verificationScreen");
}

document.querySelectorAll("[data-vehicle]").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedVehicle = normalizeVehicle(btn.dataset.vehicle);
    const info = vehicleInfo[selectedVehicle];

    $("selectedService").textContent = `${info.icon} ${info.label} ${info.roleLabel}`;

    if(currentUser){
      $("fullName").value = currentUser.user_metadata?.full_name || $("fullName").value || "";
      $("phone").value = currentUser.user_metadata?.phone || $("phone").value || "";
      $("email").value = currentUser.email || $("email").value || "";
      $("password").value = "";
      $("password").placeholder = "Already confirmed — no password needed";
      $("password").required = false;
      $("registerBtn").textContent = "Submit Driver/Rider Registration";
    }else{
      $("password").placeholder = "";
      $("password").required = true;
      $("registerBtn").textContent = "Create Registration";
    }

    setStatus($("registerStatus"), "");
    showScreen("registerScreen");
  });
});

$("backToStartBtn").addEventListener("click", () => showScreen("startScreen"));
$("showLoginBtn").addEventListener("click", () => showScreen("loginScreen"));
$("loginBackBtn").addEventListener("click", () => showScreen("startScreen"));

$("licenseFile").addEventListener("change", () => {
  const f = $("licenseFile").files?.[0];
  $("fileName").textContent = f ? f.name : "JPG, PNG or PDF — maximum 5 MB.";
});

$("registerBtn").addEventListener("click", async () => {
  const fullName = $("fullName").value.trim();
  const phone = $("phone").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;
  const licenseNumber = $("licenseNumber").value.trim();
  const file = $("licenseFile").files?.[0] || null;

  if(!selectedVehicle){
    setStatus($("registerStatus"), "Choose Bike, Auto or Car.", "bad"); return;
  }
  if(!fullName || !phone || !email || (!currentUser && !password)){
    setStatus(
      $("registerStatus"),
      currentUser
        ? "Complete your name, phone and email."
        : "Complete your name, phone, email and password.",
      "bad"
    );
    return;
  }
  if(!licenseNumber || !file){
    setStatus($("registerStatus"), "Driving licence number and licence document are required.", "bad"); return;
  }

  const info = vehicleInfo[selectedVehicle];
  $("registerBtn").disabled = true;
  setStatus($("registerStatus"), "Creating your account...");

  try{
    if(!currentUser){
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options:{ data:{ full_name:fullName, phone, account_type:"partner", vehicle_type:selectedVehicle } }
      });

      if(error) throw error;

      currentUser = data.user;
      if(!currentUser) throw new Error("Account was not returned by Supabase.");

      if(!data.session){
        setStatus($("registerStatus"),
          "Account created. Check your email and confirm it first. Then log in here to submit your licence.", "");
        $("password").value = "";
        return;
      }
    }

    await ensureProfile(currentUser, fullName, phone, selectedVehicle);
    const app = await createOrGetApplication(currentUser, fullName, phone, selectedVehicle);
    await submitLicence(app, file, licenseNumber);

    $("licenseFile").value = "";
    $("fileName").textContent = "JPG, PNG or PDF — maximum 5 MB.";
    $("password").value = "";
    await routeUser(currentUser);
  }catch(err){
    console.error(err);
    setStatus($("registerStatus"), err.message || "Registration failed.", "bad");
  }finally{
    $("registerBtn").disabled = false;
    $("registerBtn").textContent = currentUser
      ? "Submit Driver/Rider Registration"
      : "Create Registration";
  }
});

$("loginBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if(!email || !password){
    setStatus($("loginStatus"), "Enter your email and password.", "bad"); return;
  }

  $("loginBtn").disabled = true;
  setStatus($("loginStatus"), "Logging in...");
  try{
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) throw error;
    await routeUser(data.user);
  }catch(err){
    console.error(err);
    setStatus($("loginStatus"), err.message || "Login failed.", "bad");
  }finally{
    $("loginBtn").disabled = false;
  }
});

async function logout(){
  await supabase.auth.signOut();
  stopLiveLocationTracking();
  currentUser = null;
  currentApplication = null;
  selectedVehicle = "";
  dashboardBookings = [];
  if(bookingChannel){
    await supabase.removeChannel(bookingChannel);
    bookingChannel = null;
  }
  $("password").placeholder = "";
  $("password").required = true;
  $("registerBtn").textContent = "Create Registration";
  setStatus($("registerStatus"), "");
  const notice = $("existingAccountNotice");
  if(notice){
    notice.textContent = "";
    notice.className = "status hidden";
  }
  showScreen("startScreen");
}

$("logoutBtn").addEventListener("click", logout);
$("approvedLogoutBtn").addEventListener("click", logout);

function escapeHTML(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);
}

function bookingStatusLabel(status){
  return ({
    pending:"Waiting for response",
    accepted:"Accepted",
    in_progress:"In Progress",
    completed:"Completed",
    cancelled:"Cancelled"
  })[status] || status || "Unknown";
}

function formatBookingDateTime(booking){
  return [booking.booking_date || "", booking.booking_time || ""].filter(Boolean).join(" • ");
}

async function getOwnProfile(){
  if(!currentUser) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,phone,role,vehicle_type,is_online")
    .eq("id", currentUser.id)
    .maybeSingle();
  if(error) throw error;
  return data;
}

function renderDashboardBookings(){
  const list = $("driverBookingList");
  if(!list) return;

  if(!dashboardBookings.length){
    list.innerHTML = '<div class="status">No assigned ride requests right now.</div>';
    return;
  }

  list.innerHTML = dashboardBookings.map(b => {
    const status = String(b.status || "").toLowerCase();
    let actions = "";
    if(status === "pending"){
      actions = '<div class="dashboard-actions"><button class="btn accept-booking" data-id="'+b.id+'">Accept Ride</button><button class="btn danger reject-booking" data-id="'+b.id+'">Reject Ride</button></div>';
    }else if(status === "accepted"){
      actions = '<div class="dashboard-actions"><button class="btn start-booking" data-id="'+b.id+'">Start Ride</button></div>';
    }else if(status === "in_progress"){
      actions = '<div class="dashboard-actions"><button class="btn complete-booking" data-id="'+b.id+'">Complete Ride</button></div>';
    }

    return `
      <div class="ride-card">
        <div class="ride-card-top">
          <strong>${escapeHTML(b.service || "Ride")}</strong>
          <span class="pill">${escapeHTML(bookingStatusLabel(status))}</span>
        </div>
        <div class="ride-location"><b>Pickup:</b> ${escapeHTML(b.pickup_location || "—")}</div>
        <div class="ride-location"><b>Destination:</b> ${escapeHTML(b.destination || "—")}</div>
        <div class="ride-meta">
          <span>${escapeHTML(formatBookingDateTime(b) || "—")}</span>
          <span>${b.distance_km != null ? escapeHTML(String(b.distance_km)) + " km" : ""}</span>
          <span>${b.fare != null ? "₹" + escapeHTML(String(b.fare)) : ""}</span>
        </div>
        ${actions}
      </div>`;
  }).join("");

  list.querySelectorAll(".accept-booking").forEach(btn =>
    btn.addEventListener("click", () => updateAssignedBooking(btn.dataset.id, "accepted")));
  list.querySelectorAll(".start-booking").forEach(btn =>
    btn.addEventListener("click", () => updateAssignedBooking(btn.dataset.id, "in_progress")));
  list.querySelectorAll(".complete-booking").forEach(btn =>
    btn.addEventListener("click", () => updateAssignedBooking(btn.dataset.id, "completed")));
  list.querySelectorAll(".reject-booking").forEach(btn =>
    btn.addEventListener("click", () => rejectAssignedBooking(btn.dataset.id)));
}

async function loadDriverBookings(){
  if(!currentUser) return;
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("driver_id", currentUser.id)
    .in("status", ["pending","accepted","in_progress"])
    .order("created_at", { ascending:false });

  if(error){
    console.error(error);
    setStatus($("dashboardStatus"), error.message || "Could not load ride requests.", "bad");
    return;
  }

  dashboardBookings = data || [];
  renderDashboardBookings();
  syncLiveLocationTracking();
}

function stopLiveLocationTracking(){
  if(liveLocationWatchId !== null && navigator.geolocation){
    navigator.geolocation.clearWatch(liveLocationWatchId);
  }

  liveLocationWatchId = null;
  liveLocationBookingId = null;
}

async function publishLiveLocation(bookingId, position){
  if(!currentUser || !bookingId || !position?.coords) return;

  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);

  if(!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const { error } = await supabase
    .from("ride_locations")
    .upsert({
      booking_id: bookingId,
      driver_id: currentUser.id,
      latitude,
      longitude,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "booking_id"
    });

  if(error){
    console.error("Live location update error:", error);
  }
}

function startLiveLocationTracking(bookingId){
  if(!currentUser || !bookingId) return;

  if(!navigator.geolocation){
    setStatus(
      $("dashboardStatus"),
      "This device does not support live location tracking.",
      "bad"
    );
    return;
  }

  if(liveLocationBookingId === bookingId && liveLocationWatchId !== null){
    return;
  }

  stopLiveLocationTracking();
  liveLocationBookingId = bookingId;

  liveLocationWatchId = navigator.geolocation.watchPosition(
    position => {
      publishLiveLocation(bookingId, position);
    },
    error => {
      console.error("Live location error:", error);

      if(error.code === 1){
        setStatus(
          $("dashboardStatus"),
          "Location permission is required to share your live ride location.",
          "bad"
        );
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function syncLiveLocationTracking(){
  if(!currentUser){
    stopLiveLocationTracking();
    return;
  }

  const activeBooking = dashboardBookings.find(booking => {
    const status = String(booking.status || "").toLowerCase();
    return status === "accepted" || status === "in_progress";
  });

  if(activeBooking){
    startLiveLocationTracking(activeBooking.id);
  }else{
    stopLiveLocationTracking();
  }
}

async function updateOnlineStatus(isOnline){
  if(!currentUser) return;
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_online:isOnline })
    .eq("id", currentUser.id)
    .select("is_online")
    .single();

  if(error) throw error;

  $("onlineToggle").checked = !!data.is_online;
  $("onlineLabel").textContent = data.is_online ? "Online — ready for ride requests" : "Offline";
  setStatus($("dashboardStatus"),
    data.is_online ? "You are now online. Assigned ride requests will appear here." : "You are offline.",
    "ok");

  await loadDriverBookings();
}

async function updateAssignedBooking(bookingId, newStatus){
  if(!currentUser) return;
  const booking = dashboardBookings.find(x => x.id === bookingId);
  if(!booking) return;

  const allowed = {
    pending:["accepted"],
    accepted:["in_progress"],
    in_progress:["completed"]
  };
  const current = String(booking.status || "").toLowerCase();
  if(!allowed[current]?.includes(newStatus)) return;

  try{
    const { error } = await supabase
      .from("bookings")
      .update({ status:newStatus })
      .eq("id", bookingId)
      .eq("driver_id", currentUser.id);

    if(error) throw error;

    if(newStatus === "accepted"){
      startLiveLocationTracking(bookingId);
    }else if(newStatus === "completed"){
      stopLiveLocationTracking();
    }

    await loadDriverBookings();
  }catch(err){
    console.error(err);
    setStatus($("dashboardStatus"), err.message || "Could not update the ride.", "bad");
    await loadDriverBookings();
  }
}

async function rejectAssignedBooking(bookingId){
  if(!currentUser) return;
  try{
    const { error } = await supabase.rpc("reject_booking_and_reassign", {
      p_booking_id: bookingId
    });
    if(error) throw error;

    setStatus($("dashboardStatus"),
      "Ride rejected. Let's Go will look for another available driver/rider.",
      "ok");
    await loadDriverBookings();
  }catch(err){
    console.error(err);
    setStatus($("dashboardStatus"), err.message || "Could not reject the ride.", "bad");
    await loadDriverBookings();
  }
}

async function openDriverDashboard(){
  if(!currentUser) return;
  const app = await loadApplication(currentUser.id);
  if(!app || app.status !== "approved"){
    await routeUser(currentUser);
    return;
  }

  const profile = await getOwnProfile();
  if(!profile || !["driver","rider"].includes(profile.role)){
    setStatus($("dashboardStatus"), "Your account is not approved for driver/rider operations yet.", "bad");
    showScreen("verificationScreen");
    return;
  }

  const info = vehicleInfo[normalizeVehicle(profile.vehicle_type)] || {};
  $("dashboardTitle").textContent = `${info.icon || ""} ${info.label || "Let's Go"} ${info.roleLabel || ""} Dashboard`;
  $("dashboardPerson").textContent = profile.full_name || currentUser.email || "";
  $("onlineToggle").checked = !!profile.is_online;
  $("onlineLabel").textContent = profile.is_online ? "Online — ready for ride requests" : "Offline";
  setStatus($("dashboardStatus"), "");

  showScreen("dashboardScreen");
  await loadDriverBookings();
  subscribeToBookingChanges();
}

function subscribeToBookingChanges(){
  if(!currentUser) return;
  if(bookingChannel) supabase.removeChannel(bookingChannel);

  bookingChannel = supabase
    .channel("driver-bookings-"+currentUser.id)
    .on("postgres_changes", {
      event:"*",
      schema:"public",
      table:"bookings",
      filter:"driver_id=eq."+currentUser.id
    }, () => {
      loadDriverBookings();
    })
    .subscribe();
}

$("goOnlineBtn").addEventListener("click", async () => {
  try{
    await openDriverDashboard();
  }catch(err){
    console.error(err);
    setStatus(document.querySelector("#approvedScreen .status"),
      err.message || "Could not open your dashboard.", "bad");
  }
});

$("onlineToggle").addEventListener("change", async () => {
  const requested = $("onlineToggle").checked;
  try{
    await updateOnlineStatus(requested);
  }catch(err){
    console.error(err);
    $("onlineToggle").checked = !requested;
    setStatus($("dashboardStatus"), err.message || "Could not change online status.", "bad");
  }
});

$("dashboardLogoutBtn").addEventListener("click", logout);

supabase.auth.onAuthStateChange(async (_event, session) => {
  if(session?.user){
    currentUser = session.user;
    try{
      await routeUser(session.user);
    }catch(err){
      console.error(err);
    }
  }
});

const { data:{ session } } = await supabase.auth.getSession();
if(session?.user){
  try{ await routeUser(session.user); }catch(err){ console.error(err); }
}


