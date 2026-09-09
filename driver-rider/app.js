import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as CONFIG from "./config.js";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = CONFIG;
const GOOGLE_MAPS_API_KEY = CONFIG.GOOGLE_MAPS_API_KEY || "";

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

// Driver/Rider live map state. The map is shown on the approved dashboard and
// uses the same booking coordinates that the customer booking stores.
let driverMap = null;
let driverMapLoadPromise = null;
let driverMapRoutePolylines = [];
let driverMapPickupMarker = null;
let driverMapDestinationMarker = null;
let driverMapVehicleMarker = null;
let driverMapVehicleType = "";
let driverMapLivePosition = null;
let driverMapLastRoutePosition = null;
let driverMapLastRouteBookingId = null;
let driverMapLastRouteStatus = "";
let driverMapRouteRequestInFlight = false;
let driverMapRouteRequestSerial = 0;
let availabilityLocationTimer = null;
let availabilityLocationInFlight = false;

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

async function createOrGetApplication(user, fullName, phone, vehicle, vehicleRegistrationNumber){
  const info = vehicleInfo[vehicle];
  let app = await loadApplication(user.id);
  if(app) return app;

  const { data, error } = await supabase
    .from("driver_rider_applications")
    .insert({
      user_id: user.id,
      requested_role: info.role,
      vehicle_type: vehicle,
      vehicle_registration_number: vehicleRegistrationNumber,
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
    $("vehicleRegistrationNumber").value = app.vehicle_registration_number || "";
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
    await setOnlineByDefault();
    await openDriverDashboard();
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
  const vehicleRegistrationNumber = $("vehicleRegistrationNumber").value.trim().toUpperCase();
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
  if(!vehicleRegistrationNumber || vehicleRegistrationNumber.length < 4 || vehicleRegistrationNumber.length > 20){
    setStatus($("registerStatus"), "Enter a valid vehicle registration number.", "bad"); return;
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
    const app = await createOrGetApplication(currentUser, fullName, phone, selectedVehicle, vehicleRegistrationNumber);

    const { data: refreshedApplication, error: registrationUpdateError } = await supabase
      .from("driver_rider_applications")
      .update({
        vehicle_registration_number: vehicleRegistrationNumber,
        updated_at: new Date().toISOString()
      })
      .eq("id", app.id)
      .eq("user_id", currentUser.id)
      .select("*")
      .single();

    if(registrationUpdateError) throw registrationUpdateError;

    currentApplication = refreshedApplication;
    await submitLicence(refreshedApplication, file, licenseNumber);

    $("licenseFile").value = "";
    $("vehicleRegistrationNumber").value = "";
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

async function setOnlineByDefault(){
  if(!currentUser) return;

  const toggle = $("onlineToggle");
  if(toggle) toggle.checked = true;

  const label = $("onlineLabel");
  if(label) label.textContent = "Online — ready for ride requests";

  try{
    const { error } = await supabase
      .from("profiles")
      .update({ is_online:true })
      .eq("id", currentUser.id);
    if(error) console.warn("Could not set driver/rider online by default.", error);
  }catch(err){
    console.warn("Could not set driver/rider online by default.", err);
  }

  startAvailabilityLocationSharing();
}

async function logout(){
  await clearAvailabilityLocation();

  if(currentUser){
    try{
      await supabase
        .from("profiles")
        .update({ is_online:false })
        .eq("id", currentUser.id);
    }catch(err){
      console.warn("Could not mark driver/rider offline before logout.", err);
    }
  }

  await supabase.auth.signOut();
  stopLiveLocationTracking();
  currentUser = null;
  currentApplication = null;
  selectedVehicle = "";
  dashboardBookings = [];
  $("dashboardCurrentPanel")?.classList.remove("hidden");
  $("dashboardHistoryPanel")?.classList.add("hidden");
  $("dashboardProfilePanel")?.classList.add("hidden");
  $("dashboardCurrentTab")?.classList.add("active");
  $("dashboardHistoryTab")?.classList.remove("active");
  $("dashboardProfileTab")?.classList.remove("active");
  clearDriverMapRoute();
  clearDriverMapMarkers();
  driverMapLivePosition = null;
  driverMapLastRoutePosition = null;
  driverMapLastRouteBookingId = null;
  driverMapLastRouteStatus = "";
  driverMapVehicleType = "";
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


// ============================================================
// DRIVER / RIDER GOOGLE MAP
// ============================================================

function driverMapCoords(booking, prefix){
  const lat = Number(booking?.[prefix + "_lat"]);
  const lng = Number(booking?.[prefix + "_lng"]);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function driverMapDistanceMeters(a, b){
  if(!a || !b) return Infinity;
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function clearDriverMapRoute(){
  driverMapRoutePolylines.forEach(polyline => {
    try { polyline?.setMap?.(null); } catch (_) {}
  });
  driverMapRoutePolylines = [];
}

function clearDriverMapMarkers(){
  [driverMapPickupMarker, driverMapDestinationMarker, driverMapVehicleMarker].forEach(marker => {
    try { marker?.setMap?.(null); } catch (_) {}
  });
  driverMapPickupMarker = null;
  driverMapDestinationMarker = null;
  driverMapVehicleMarker = null;
}

function getDriverMapVehicleEmoji(vehicleType){
  const normalized = normalizeVehicle(vehicleType);
  return vehicleInfo[normalized]?.icon || "🚗";
}

async function loadDriverGoogleMaps(){
  if(window.google?.maps?.importLibrary) return;
  if(driverMapLoadPromise) return driverMapLoadPromise;
  if(!GOOGLE_MAPS_API_KEY){
    throw new Error("Google Maps API key is missing from driver-rider/config.js.");
  }

  driverMapLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-lets-go-driver-google-maps="true"]');
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const finish = () => {
      if(settled) return;
      settled = true;
      if(pollTimer) clearInterval(pollTimer);
      if(timeoutTimer) clearTimeout(timeoutTimer);
      resolve();
    };

    const fail = message => {
      if(settled) return;
      settled = true;
      if(pollTimer) clearInterval(pollTimer);
      if(timeoutTimer) clearTimeout(timeoutTimer);
      driverMapLoadPromise = null;
      reject(new Error(message));
    };

    if(existingScript){
      if(window.google?.maps?.importLibrary){
        finish();
        return;
      }
      existingScript.addEventListener("error", () => fail("Google Maps failed to load."), { once:true });
      pollTimer = setInterval(() => {
        if(window.google?.maps?.importLibrary) finish();
      }, 50);
      timeoutTimer = setTimeout(() => fail("Google Maps did not finish loading. Check the API key and Google Cloud settings."), 15000);
      return;
    }

    const callbackName = "__letsGoDriverGoogleMapsReady_" + Date.now();
    window[callbackName] = () => {
      if(window.google?.maps?.importLibrary) finish();
    };

    const script = document.createElement("script");
    script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(GOOGLE_MAPS_API_KEY) + "&loading=async&libraries=places&callback=" + callbackName;
    script.async = true;
    script.defer = true;
    script.dataset.letsGoDriverGoogleMaps = "true";
    script.addEventListener("load", () => {
      if(window.google?.maps?.importLibrary) finish();
    }, { once:true });
    script.onerror = () => fail("Google Maps failed to load. Check the API key and Google Cloud settings.");
    document.head.appendChild(script);

    pollTimer = setInterval(() => {
      if(window.google?.maps?.importLibrary) finish();
    }, 50);
    timeoutTimer = setTimeout(() => fail("Google Maps did not finish loading. Check the API key and Google Cloud settings."), 15000);
  });

  return driverMapLoadPromise;
}

async function initializeDriverMap(){
  const mapElement = $("driverMap");
  if(!mapElement) return;

  try{
    await loadDriverGoogleMaps();
    const [{ Map }, { Marker }] = await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("marker")
    ]);

    if(driverMap){
      google.maps.event.trigger(driverMap, "resize");
      return;
    }

    driverMap = new Map(mapElement, {
      center:{ lat:20.5937, lng:78.9629 },
      zoom:5,
      mapTypeControl:false,
      streetViewControl:false,
      fullscreenControl:true,
      gestureHandling:"greedy"
    });

    // Keep the constructor available for the live vehicle marker.
    window.__letsGoDriverMarkerClass = Marker || google.maps.Marker;
    setStatus($("dashboardStatus"), "");
  }catch(error){
    console.error("Driver/Rider Google Maps loading error:", error);
    mapElement.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;padding:20px;text-align:center"><div><strong>Map could not be loaded.</strong><p>Check the Google Maps API key in driver-rider/config.js and Google Cloud settings.</p></div></div>`;
    $("driverMapStatus").textContent = error.message || "Google Maps could not be loaded.";
  }
}

function updateDriverMapVehicleMarker(position){
  if(!driverMap || !position) return;
  const Marker = window.__letsGoDriverMarkerClass || google.maps.Marker;
  if(!driverMapVehicleMarker){
    driverMapVehicleMarker = new Marker({
      position,
      map:driverMap,
      title:`Your live ${vehicleInfo[normalizeVehicle(driverMapVehicleType)]?.label || "vehicle"} location`,
      label:{ text:getDriverMapVehicleEmoji(driverMapVehicleType), fontSize:"28px" },
      zIndex:1000
    });
  }else{
    driverMapVehicleMarker.setPosition(position);
    driverMapVehicleMarker.setLabel({ text:getDriverMapVehicleEmoji(driverMapVehicleType), fontSize:"28px" });
    driverMapVehicleMarker.setMap(driverMap);
  }
}

function fitDriverMapToPoints(points){
  if(!driverMap || !points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach(point => bounds.extend(point));
  if(points.length === 1){
    driverMap.panTo(points[0]);
    driverMap.setZoom(16);
  }else{
    driverMap.fitBounds(bounds, 55);
  }
}

async function drawDriverMapRoute(booking, origin, destination, status){
  if(!driverMap || !origin || !destination) return;
  const serial = ++driverMapRouteRequestSerial;
  driverMapRouteRequestInFlight = true;

  try{
    const { Route } = await google.maps.importLibrary("routes");
    const result = await Route.computeRoutes({
      origin,
      destination,
      travelMode:"DRIVING",
      fields:["path","viewport","distanceMeters","durationMillis"]
    });

    if(serial !== driverMapRouteRequestSerial) return;
    clearDriverMapRoute();

    const route = result?.routes?.[0];
    if(!route){
      $("driverMapStatus").textContent = "No road route was found for this ride.";
      return;
    }

    driverMapRoutePolylines = route.createPolylines({
      polylineOptions:{ strokeWeight:5, zIndex:10 }
    });
    driverMapRoutePolylines.forEach(polyline => polyline.setMap(driverMap));

    if(route.viewport) driverMap.fitBounds(route.viewport, 55);
    driverMapLastRoutePosition = driverMapLivePosition ? {...driverMapLivePosition} : null;
    driverMapLastRouteBookingId = booking.id;
    driverMapLastRouteStatus = status;

    const km = route.distanceMeters != null ? (route.distanceMeters / 1000).toFixed(1) : null;
    const minutes = route.durationMillis != null ? Math.max(1, Math.round(route.durationMillis / 60000)) : null;
    const phase = status === "accepted" ? "Route to pickup" : "Route to destination";
    $("driverMapStatus").textContent = [phase, km ? `${km} km` : "", minutes ? `about ${minutes} min` : ""].filter(Boolean).join(" • ");
  }catch(error){
    if(serial !== driverMapRouteRequestSerial) return;
    console.error("Driver/Rider route error:", error);
    $("driverMapStatus").textContent = "Road route could not be calculated. Check that the Routes API is enabled.";
  }finally{
    if(serial === driverMapRouteRequestSerial) driverMapRouteRequestInFlight = false;
  }
}

async function renderDriverMapForBooking(booking){
  if(!booking) return;
  await initializeDriverMap();
  if(!driverMap) return;

  const pickup = driverMapCoords(booking, "pickup");
  const destination = driverMapCoords(booking, "destination");
  const status = String(booking.status || "").toLowerCase();

  if(!pickup || !destination){
    clearDriverMapRoute();
    $("driverMapStatus").textContent = "This booking does not contain map coordinates yet.";
    return;
  }

  const Marker = window.__letsGoDriverMarkerClass || google.maps.Marker;

  if(driverMapPickupMarker) driverMapPickupMarker.setMap(null);
  if(driverMapDestinationMarker) driverMapDestinationMarker.setMap(null);

  driverMapPickupMarker = new Marker({ position:pickup, map:driverMap, title:"Pickup" });
  driverMapDestinationMarker = new Marker({ position:destination, map:driverMap, title:"Destination" });

  if(driverMapLivePosition){
    updateDriverMapVehicleMarker(driverMapLivePosition);
  }

  const routeOrigin = (status === "accepted" || status === "in_progress") && driverMapLivePosition
    ? driverMapLivePosition
    : pickup;
  const routeDestination = status === "accepted" ? pickup : destination;
  const routeStatus = status === "accepted" ? "accepted" : "in_progress";

  const routeNeedsRefresh =
    driverMapLastRouteBookingId !== booking.id ||
    driverMapLastRouteStatus !== routeStatus ||
    !driverMapLastRoutePosition ||
    driverMapDistanceMeters(driverMapLastRoutePosition, routeOrigin) > 100;

  if(routeNeedsRefresh && !driverMapRouteRequestInFlight){
    await drawDriverMapRoute(booking, routeOrigin, routeDestination, routeStatus);
  }else if(!driverMapLastRouteBookingId){
    fitDriverMapToPoints([pickup, destination]);
  }
}

async function refreshDriverMapFromBookings(){
  const activeBooking = dashboardBookings.find(booking => {
    const status = String(booking.status || "").toLowerCase();
    return status === "pending" || status === "accepted" || status === "in_progress";
  });

  if(!activeBooking){
    setDriverMapVisibility(false);
    return;
  }

  setDriverMapVisibility(true);
  await renderDriverMapForBooking(activeBooking);
}

const profilePictureStyle = document.createElement("style");
profilePictureStyle.textContent = `
  .driver-profile-picture-section{
    display:flex;
    align-items:center;
    gap:16px;
    margin-bottom:18px;
    padding:14px;
    border:1px solid rgba(255,255,255,.10);
    border-radius:14px;
  }
  .driver-profile-picture{
    width:76px;
    height:76px;
    min-width:76px;
    border-radius:50%;
    object-fit:cover;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
  }
  .driver-profile-placeholder{
    font-weight:700;
    font-size:24px;
    background:rgba(255,255,255,.10);
  }
  .driver-profile-picture-actions{
    display:flex;
    flex-direction:column;
    gap:6px;
  }
  .profile-edit-section{
    margin-top:20px;
    padding-top:18px;
    border-top:1px solid rgba(0,0,0,.10);
  }
  .profile-edit-form{
    display:flex;
    flex-direction:column;
    gap:8px;
    margin-top:12px;
  }
  .profile-edit-form label{
    font-weight:600;
  }
  .profile-edit-form input{
    width:100%;
    box-sizing:border-box;
    padding:12px 14px;
    border:1px solid rgba(0,0,0,.18);
    border-radius:10px;
    font:inherit;
  }
  .profile-edit-form input:focus{
    outline:2px solid rgba(100,60,220,.25);
  }
  .profile-phone-otp{
    margin-top:16px;
    padding-top:16px;
    border-top:1px solid rgba(0,0,0,.10);
  }
`;
document.head.appendChild(profilePictureStyle);

const PROFILE_PICTURE_BUCKET = "driver-rider-profile-pictures";
const PROFILE_PICTURE_MAX_SIZE = 5 * 1024 * 1024;
const PROFILE_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function getOwnProfile(){
  if(!currentUser) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
    .eq("id", currentUser.id)
    .maybeSingle();
  if(error) throw error;
  return data;
}

function getProfilePictureUrl(){
  return String(currentUser?.user_metadata?.profile_picture_url || "").trim();
}

function getProfilePicturePublicUrl(){
  const path = getProfilePicturePath();
  if(!path) return "";
  const { data } = supabase.storage
    .from(PROFILE_PICTURE_BUCKET)
    .getPublicUrl(path);
  return String(data?.publicUrl || "").trim();
}

async function refreshCurrentUser(){
  const { data, error } = await supabase.auth.getUser();
  if(!error && data?.user){
    currentUser = data.user;
  }
  return currentUser;
}

function getProfilePicturePath(){
  return currentUser?.id ? `${currentUser.id}/profile` : "";
}

function profileInitials(name){
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return "LG";
  if(parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function uploadDriverRiderProfilePicture(file){
  if(!currentUser) throw new Error("Please log in again.");
  if(!file) throw new Error("Choose a profile picture first.");

  const profile = await getOwnProfile();
  if(!profile || !["driver","rider"].includes(profile.role)){
    throw new Error("Only approved drivers and riders can change a profile picture.");
  }

  if(!PROFILE_PICTURE_TYPES.includes(file.type)){
    throw new Error("Use a JPG, PNG or WebP image.");
  }

  if(file.size > PROFILE_PICTURE_MAX_SIZE){
    throw new Error("Profile picture must be 5 MB or smaller.");
  }

  const path = getProfilePicturePath();
  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PICTURE_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "3600"
    });

  if(uploadError){
    console.error("Profile picture upload error:", uploadError);
    throw new Error(
      uploadError.message ||
      "Could not upload the profile picture. Make sure the profile-picture storage bucket is configured."
    );
  }

  const { data: publicData } = supabase.storage
    .from(PROFILE_PICTURE_BUCKET)
    .getPublicUrl(path);

  const publicUrl = publicData?.publicUrl;
  if(!publicUrl) throw new Error("Profile picture URL could not be created.");

  const cacheBustedUrl = publicUrl + (publicUrl.includes("?") ? "&" : "?") + "v=" + Date.now();

  const { data: updatedUser, error: metadataError } = await supabase.auth.updateUser({
    data: {
      ...(currentUser.user_metadata || {}),
      profile_picture_url: cacheBustedUrl,
      profile_picture_path: path
    }
  });

  if(metadataError){
    console.error("Profile picture metadata update error:", metadataError);
    throw new Error(
      metadataError.message ||
      "Picture uploaded, but the profile could not be updated."
    );
  }

  if(updatedUser?.user){
    currentUser = updatedUser.user;
  }

  return cacheBustedUrl;
}

async function removeDriverRiderProfilePicture(){
  if(!currentUser) throw new Error("Please log in again.");

  const profile = await getOwnProfile();
  if(!profile || !["driver","rider"].includes(profile.role)){
    throw new Error("Only approved drivers and riders can change a profile picture.");
  }

  const path = String(currentUser.user_metadata?.profile_picture_path || getProfilePicturePath());

  if(path){
    const { error: removeError } = await supabase.storage
      .from(PROFILE_PICTURE_BUCKET)
      .remove([path]);

    if(removeError){
      console.error("Profile picture remove error:", removeError);
      throw new Error(removeError.message || "Could not remove the profile picture.");
    }
  }

  const { data: updatedUser, error: metadataError } = await supabase.auth.updateUser({
    data: {
      ...(currentUser.user_metadata || {}),
      profile_picture_url: null,
      profile_picture_path: null
    }
  });

  if(metadataError){
    console.error("Profile picture metadata remove error:", metadataError);
    throw new Error(metadataError.message || "Could not update the profile.");
  }

  if(updatedUser?.user){
    currentUser = updatedUser.user;
  }
}

function setDriverMapVisibility(show){
  const card = $("driverMapCard");
  if(!card) return;
  card.classList.toggle("hidden", !show);

  if(!show){
    clearDriverMapRoute();
    clearDriverMapMarkers();
    driverMapLivePosition = null;
    driverMapLastRoutePosition = null;
    driverMapLastRouteBookingId = null;
    driverMapLastRouteStatus = "";
    if($("driverMapStatus")){
      $("driverMapStatus").textContent = "Your assigned ride route and live vehicle location will appear here.";
    }
  }
}

function renderDashboardBookings(){
  const list = $("driverBookingList");
  if(!list) return;

  const hasActiveRide = dashboardBookings.some(b =>
    ["pending","accepted","in_progress"].includes(String(b.status || "").toLowerCase())
  );
  setDriverMapVisibility(hasActiveRide);

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
  void refreshDriverMapFromBookings();
  syncLiveLocationTracking();
}

function stopLiveLocationTracking(){
  if(liveLocationWatchId !== null && navigator.geolocation){
    navigator.geolocation.clearWatch(liveLocationWatchId);
  }

  liveLocationWatchId = null;
  liveLocationBookingId = null;
}

/*
  Assignment policy:
  - Prefer the nearest eligible Driver/Rider.
  - Start the search at 2 km from pickup.
  - If nobody is available within 2 km, expand the search radius progressively
    until an eligible Driver/Rider is found.
  - If distances are effectively tied, prefer the person who has been waiting longest.
  - Never hard-reject a booking solely because everyone is beyond 2 km.
  The actual selection/radius logic will be implemented in the Supabase
  assign_booking_driver RPC.
*/

async function publishAvailabilityLocation(position){
  if(!currentUser || !position || !$("onlineToggle")?.checked) return;
  if(availabilityLocationInFlight) return;

  availabilityLocationInFlight = true;
  try{
    const { error } = await supabase
      .from("driver_rider_locations")
      .upsert({
        driver_id: currentUser.id,
        latitude: position.lat,
        longitude: position.lng,
        updated_at: new Date().toISOString()
      }, { onConflict:"driver_id" });

    if(error){
      console.error("Could not publish availability location.", error);
      setStatus(
        $("dashboardStatus"),
        "GPS received, but Supabase rejected it: " + (error.message || error.code || "Unknown Supabase error"),
        "bad"
      );
    }else{
      setStatus(
        $("dashboardStatus"),
        "GPS working — your availability location was updated.",
        "ok"
      );
    }
  }catch(err){
    console.error("Could not publish availability location.", err);
    setStatus(
      $("dashboardStatus"),
      "GPS upload error: " + (err.message || "Unknown error"),
      "bad"
    );
  }finally{
    availabilityLocationInFlight = false;
  }
}

function stopAvailabilityLocationSharing(){
  if(availabilityLocationTimer){
    clearInterval(availabilityLocationTimer);
    availabilityLocationTimer = null;
  }
}

function startAvailabilityLocationSharing(){
  stopAvailabilityLocationSharing();
  const toggle = $("onlineToggle");
  if(!currentUser || !toggle?.checked) return;

  if(!navigator.geolocation){
    setStatus(
      $("dashboardStatus"),
      "GPS: This browser/preview does not provide location services.",
      "bad"
    );
    return;
  }

  const send = () => navigator.geolocation.getCurrentPosition(
    pos => {
      setStatus(
        $("dashboardStatus"),
        "GPS position received — sending location to Supabase...",
        "ok"
      );

      publishAvailabilityLocation({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      });
    },
    err => {
      console.warn("Availability location error.", err);

      let message = "GPS error: Unable to get your location.";
      if(err?.code === 1){
        message = "GPS: Location permission denied. Allow location access for letsgoapp.in in Chrome.";
      }else if(err?.code === 2){
        message = "GPS: Location unavailable. Turn on phone Location/GPS and try again.";
      }else if(err?.code === 3){
        message = "GPS: Location request timed out. Move to an area with a clearer GPS signal and try again.";
      }else if(err?.message){
        message = "GPS: " + err.message;
      }

      setStatus($("dashboardStatus"), message, "bad");
    },
    { enableHighAccuracy:true, maximumAge:10000, timeout:10000 }
  );

  send();
  availabilityLocationTimer = setInterval(send, 15000);
}

async function clearAvailabilityLocation(){
  if(!currentUser) return;
  stopAvailabilityLocationSharing();

  try{
    const { error } = await supabase
      .from("driver_rider_locations")
      .delete()
      .eq("driver_id", currentUser.id);

    if(error) console.warn("Could not clear availability location.", error);
  }catch(err){
    console.warn("Could not clear availability location.", err);
  }
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
    setStatus(
      $("dashboardStatus"),
      "GPS received, but Supabase rejected the location: " + (error.message || error.code || "Unknown error"),
      "bad"
    );
  }else{
    setStatus(
      $("dashboardStatus"),
      "Live location updated successfully.",
      "good"
    );
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
      driverMapLivePosition = {
        lat:Number(position.coords.latitude),
        lng:Number(position.coords.longitude)
      };
      updateDriverMapVehicleMarker(driverMapLivePosition);
      const activeBooking = dashboardBookings.find(b => b.id === bookingId);
      if(activeBooking){
        void renderDriverMapForBooking(activeBooking);
      }
      publishLiveLocation(bookingId, position);
    },
    error => {
      console.error("Live location error:", error);

      let message = "Live location error";
      if(error.code === 1){
        message = "Location permission is required to share your live ride location.";
      }else if(error.code === 2){
        message = "GPS position is unavailable: " + (error.message || "Unknown GPS error");
      }else if(error.code === 3){
        message = "GPS request timed out: " + (error.message || "Unknown GPS error");
      }else if(error.message){
        message = "Live location error: " + error.message;
      }

      setStatus($("dashboardStatus"), message, "bad");
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
  $("onlineLabel").textContent = data.is_online
    ? "Online — ready for ride requests"
    : "Offline";

  setStatus(
    $("dashboardStatus"),
    data.is_online
      ? "You are now online. Assigned ride requests will appear here."
      : "You are offline.",
    "ok"
  );

  if(data.is_online){
    startAvailabilityLocationSharing();
  }else{
    await clearAvailabilityLocation();
  }

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

function setDashboardPanel(panel){
  const panels = {
    current: ["dashboardCurrentPanel", "dashboardCurrentTab"],
    history: ["dashboardHistoryPanel", "dashboardHistoryTab"],
    profile: ["dashboardProfilePanel", "dashboardProfileTab"]
  };

  Object.entries(panels).forEach(([name, ids]) => {
    const panelElement = $(ids[0]);
    const tabElement = $(ids[1]);
    const active = name === panel;
    panelElement?.classList.toggle("hidden", !active);
    tabElement?.classList.toggle("active", active);
  });

  if(panel === "history"){
    void loadRideHistory();
  }else if(panel === "profile"){
    void loadDriverProfileDetails();
  }
}

async function loadRideHistory(){
  if(!currentUser) return;

  const list = $("rideHistoryList");
  const summary = $("rideHistorySummary");
  if(!list) return;

  list.innerHTML = '<div class="status">Loading ride history...</div>';

  // Load every booking assigned to this Driver/Rider first.
  // Filtering only for `completed`/`cancelled` can hide older rides if the
  // database contains a different terminal status value. We classify the
  // active rides below and keep all non-active assigned rides in history.
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("driver_id", currentUser.id)
    .order("created_at", { ascending:false });

  if(error){
    console.error("Ride history error:", error);
    list.innerHTML = '<div class="status bad">Could not load ride history: ' + escapeHTML(error.message || "Unknown error") + '</div>';
    return;
  }

  const allRows = data || [];
  const activeStatuses = new Set(["pending", "accepted", "in_progress"]);
  const rows = allRows.filter(b => !activeStatuses.has(String(b.status || "").toLowerCase()));
  const completed = rows.filter(b => String(b.status || "").toLowerCase() === "completed");
  const cancelled = rows.filter(b => String(b.status || "").toLowerCase() === "cancelled");
  const totalFare = completed.reduce((sum,b) => {
    const value = Number(b.fare);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  if(summary){
    summary.innerHTML = `
      <div class="summary-box"><span class="muted small">Completed</span><strong>${completed.length}</strong></div>
      <div class="summary-box"><span class="muted small">Cancelled</span><strong>${cancelled.length}</strong></div>
      <div class="summary-box"><span class="muted small">Total fare</span><strong>₹${totalFare.toFixed(2)}</strong></div>
      <div class="summary-box"><span class="muted small">Total rides</span><strong>${rows.length}</strong></div>
    `;
  }

  if(!rows.length){
    list.innerHTML = '<div class="status">No previous rides yet.</div>';
    return;
  }

  list.innerHTML = rows.map(b => {
    const status = String(b.status || "").toLowerCase();
    const statusText = bookingStatusLabel(status);
    return `
      <div class="ride-card">
        <div class="ride-card-top">
          <strong>${escapeHTML(vehicleInfo[normalizeVehicle(b.service)]?.label || b.service || "Ride")}</strong>
          <span class="pill">${escapeHTML(statusText)}</span>
        </div>
        <div class="ride-location"><b>Pickup:</b> ${escapeHTML(b.pickup_location || "—")}</div>
        <div class="ride-location"><b>Destination:</b> ${escapeHTML(b.destination || "—")}</div>
        <div class="ride-meta">
          <span>${escapeHTML(formatBookingDateTime(b) || "—")}</span>
          ${b.distance_km != null ? `<span>${escapeHTML(String(b.distance_km))} km</span>` : ""}
          ${b.fare != null ? `<span>₹${escapeHTML(String(b.fare))}</span>` : ""}
        </div>
      </div>`;
  }).join("");
}



async function updateOwnProfileName(fullName){
  if(!currentUser) throw new Error("Please log in again.");

  const cleanName = String(fullName || "").trim().replace(/\s+/g, " ");

  if(cleanName.length < 2){
    throw new Error("Please enter your full name.");
  }
  if(cleanName.length > 80){
    throw new Error("Name must be 80 characters or fewer.");
  }

  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: cleanName })
    .eq("id", currentUser.id)
    .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
    .maybeSingle();

  if(profileError){
    console.error("Profile name update error:", profileError);
    throw new Error(profileError.message || "Could not update your name.");
  }

  if(!updatedProfile){
    throw new Error("Your profile could not be updated. Please try again.");
  }

  const { data: updatedUser, error: metadataError } = await supabase.auth.updateUser({
    data: {
      ...(currentUser.user_metadata || {}),
      full_name: cleanName
    }
  });

  if(metadataError){
    console.warn("Name updated, but account metadata could not be refreshed:", metadataError);
  }else if(updatedUser?.user){
    currentUser = updatedUser.user;
  }

  return updatedProfile;
}

async function requestDriverRiderPhoneChange(newPhone){
  if(!currentUser) throw new Error("Please log in again.");

  const cleanPhone = String(newPhone || "").trim();
  const phoneDigits = cleanPhone.replace(/\D/g, "");

  if(phoneDigits.length < 7 || phoneDigits.length > 15){
    throw new Error("Please enter a valid phone number.");
  }

  const currentPhone = String(
    currentUser.phone ||
    currentUser.user_metadata?.phone ||
    ""
  ).trim();

  if(currentPhone && currentPhone === cleanPhone){
    return { unchanged: true };
  }

  // Supabase sends a verification OTP to the new phone number when
  // phone-change verification is enabled.
  const { data, error } = await supabase.auth.updateUser({
    phone: cleanPhone
  });

  if(error){
    console.error("Phone change request error:", error);
    throw new Error(error.message || "Could not send the phone verification code.");
  }

  return { data, unchanged: false };
}

async function verifyDriverRiderPhoneChange(newPhone, otp){
  if(!currentUser) throw new Error("Please log in again.");

  const cleanPhone = String(newPhone || "").trim();
  const cleanOtp = String(otp || "").trim();

  if(!cleanOtp || !/^\d{4,8}$/.test(cleanOtp)){
    throw new Error("Please enter the verification code.");
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: cleanPhone,
    token: cleanOtp,
    type: "phone_change"
  });

  if(error){
    console.error("Phone change verification error:", error);
    throw new Error(error.message || "The verification code is invalid or expired.");
  }

  // Keep the public profiles table in sync with the verified Auth phone.
  const verifiedPhone = data?.user?.phone || cleanPhone;

  const { data: updatedProfile, error: profileError } = await supabase
    .from("profiles")
    .update({ phone: verifiedPhone })
    .eq("id", currentUser.id)
    .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
    .maybeSingle();

  if(profileError){
    console.error("Verified phone profile sync error:", profileError);
    throw new Error(profileError.message || "Phone verified, but profile sync failed.");
  }

  if(data?.user){
    currentUser = data.user;
  }

  return updatedProfile;
}

async function loadDriverProfileDetails(){
  const container = $("driverProfileDetails");
  if(!container || !currentUser) return;

  container.innerHTML = '<div class="status">Loading profile...</div>';

  try{
    await refreshCurrentUser();
    const profile = await getOwnProfile();
    if(!profile){
      container.innerHTML = '<div class="status bad">Profile could not be found.</div>';
      return;
    }

    const vehicle = normalizeVehicle(profile.vehicle_type);
    const info = vehicleInfo[vehicle] || {};
    const roleLabel = profile.role === "rider" ? "Rider" : profile.role === "driver" ? "Driver" : (profile.role || "—");
    const onlineText = profile.is_online ? "Online" : "Offline";

    const pictureUrl = getProfilePictureUrl() || getProfilePicturePublicUrl();
    const initials = profileInitials(profile.full_name || currentUser.email || "");
    const pictureMarkup = pictureUrl
      ? `<img id="driverProfilePicture" src="${escapeHTML(pictureUrl)}" alt="Profile picture" class="driver-profile-picture" data-profile-initials="${escapeHTML(initials)}">`
      : `<div id="driverProfilePicture" class="driver-profile-picture driver-profile-placeholder" aria-label="Profile picture">${escapeHTML(initials)}</div>`;

    container.innerHTML = `
      <div class="driver-profile-picture-section">
        ${pictureMarkup}
        <div class="driver-profile-picture-actions">
          <strong>Profile picture</strong>
          <span class="muted small">JPG, PNG or WebP · maximum 5 MB</span>
          <div class="dashboard-actions">
            <button type="button" class="btn" id="changeDriverProfilePictureBtn">Change picture</button>
            ${pictureUrl ? '<button type="button" class="btn danger" id="removeDriverProfilePictureBtn">Remove</button>' : ''}
          </div>
          <input type="file" id="driverProfilePictureInput" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
      </div>

      <div class="profile-row"><span class="muted">Name</span><span><strong>${escapeHTML(profile.full_name || "—")}</strong></span></div>
      <div class="profile-row"><span class="muted">Phone</span><span>${escapeHTML(profile.phone || "—")}</span></div>
      <div class="profile-row"><span class="muted">Email</span><span>${escapeHTML(currentUser.email || "—")}</span></div>
      <div class="profile-row"><span class="muted">Account</span><span>${escapeHTML(roleLabel)}</span></div>
      <div class="profile-row"><span class="muted">Vehicle</span><span>${escapeHTML(info.label || vehicle || "—")}</span></div>
      <div class="profile-row"><span class="muted">Registration</span><span>${escapeHTML(profile.vehicle_registration_number || "—")}</span></div>
      <div class="profile-row"><span class="muted">Status</span><span>${escapeHTML(onlineText)}</span></div>
      <div class="profile-row"><span class="muted">Account ID</span><span class="small">${escapeHTML(currentUser.id)}</span></div>

      <div class="profile-edit-section">
        <button type="button" class="btn" id="editDriverProfileBtn">Edit profile</button>

        <form id="driverProfileEditForm" class="profile-edit-form" hidden>
          <label for="driverProfileName">Full name</label>
          <input id="driverProfileName" type="text" maxlength="80"
                 value="${escapeHTML(profile.full_name || "")}"
                 autocomplete="name">

          <label for="driverProfilePhone">Phone number</label>
          <input id="driverProfilePhone" type="tel" maxlength="20"
                 value="${escapeHTML(profile.phone || "")}"
                 autocomplete="tel">

          <label for="driverProfileVehicleRegistration">Vehicle registration number</label>
          <input id="driverProfileVehicleRegistration" type="text" maxlength="20"
                 value="${escapeHTML(profile.vehicle_registration_number || "")}"
                 autocomplete="off" placeholder="e.g. TS09AB1234">

          <div class="dashboard-actions">
            <button type="submit" class="btn" id="saveDriverProfileBtn">Save name</button>
            <button type="button" class="btn" id="cancelDriverProfileBtn">Cancel</button>
          </div>

          <div id="driverProfileEditStatus" class="small muted" aria-live="polite"></div>

          <div id="driverPhoneOtpSection" class="profile-phone-otp" hidden>
            <label for="driverPhoneOtp">Verification code</label>
            <input id="driverPhoneOtp" type="text" inputmode="numeric"
                   autocomplete="one-time-code" maxlength="8"
                   placeholder="Enter OTP">

            <div class="dashboard-actions">
              <button type="button" class="btn" id="verifyDriverPhoneBtn">Verify phone</button>
              <button type="button" class="btn" id="cancelDriverPhoneOtpBtn">Cancel phone change</button>
            </div>

            <div id="driverPhoneOtpStatus" class="small muted" aria-live="polite"></div>
          </div>
        </form>
      </div>
    `;

    const profilePictureImage = $("driverProfilePicture");
    if(profilePictureImage?.tagName === "IMG"){
      profilePictureImage.addEventListener("error", () => {
        const initialsText = profilePictureImage.dataset.profileInitials || "LG";
        const fallback = document.createElement("div");
        fallback.id = "driverProfilePicture";
        fallback.className = "driver-profile-picture driver-profile-placeholder";
        fallback.setAttribute("aria-label", "Profile picture");
        fallback.textContent = initialsText;
        profilePictureImage.replaceWith(fallback);
      }, { once: true });
    }

    const pictureInput = $("driverProfilePictureInput");
    const changePictureBtn = $("changeDriverProfilePictureBtn");
    const removePictureBtn = $("removeDriverProfilePictureBtn");

    changePictureBtn?.addEventListener("click", () => pictureInput?.click());

    pictureInput?.addEventListener("change", async () => {
      const file = pictureInput.files?.[0];
      pictureInput.value = "";
      if(!file) return;

      setStatus($("dashboardStatus"), "Uploading profile picture...");
      try{
        await uploadDriverRiderProfilePicture(file);
        setStatus($("dashboardStatus"), "Profile picture updated successfully.", "good");
        await loadDriverProfileDetails();
      }catch(error){
        console.error(error);
        setStatus(
          $("dashboardStatus"),
          error.message || "Could not update the profile picture.",
          "bad"
        );
      }
    });


    const editProfileBtn = $("editDriverProfileBtn");
    const editProfileForm = $("driverProfileEditForm");
    const cancelEditProfileBtn = $("cancelDriverProfileBtn");
    const saveProfileBtn = $("saveDriverProfileBtn");
    const editProfileStatus = $("driverProfileEditStatus");

    const phoneOtpSection = $("driverPhoneOtpSection");
    const phoneOtpInput = $("driverPhoneOtp");
    const verifyPhoneBtn = $("verifyDriverPhoneBtn");
    const cancelPhoneOtpBtn = $("cancelDriverPhoneOtpBtn");
    const phoneOtpStatus = $("driverPhoneOtpStatus");

    let pendingPhoneChange = null;

    editProfileBtn?.addEventListener("click", () => {
      if(!editProfileForm) return;
      editProfileForm.hidden = false;
      editProfileBtn.hidden = true;
      $("driverProfileName")?.focus();
    });

    cancelEditProfileBtn?.addEventListener("click", () => {
      if(!editProfileForm) return;
      editProfileForm.hidden = true;
      if(editProfileBtn) editProfileBtn.hidden = false;
      if(editProfileStatus) editProfileStatus.textContent = "";
      if(phoneOtpSection) phoneOtpSection.hidden = true;
      pendingPhoneChange = null;
      if(phoneOtpInput) phoneOtpInput.value = "";
      if(phoneOtpStatus) phoneOtpStatus.textContent = "";
    });

    editProfileForm?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const nameInput = $("driverProfileName");
      const phoneInput = $("driverProfilePhone");
      const vehicleRegistrationInput = $("driverProfileVehicleRegistration");
      const name = nameInput?.value || "";
      const phone = phoneInput?.value || "";
      const vehicleRegistrationNumber = String(vehicleRegistrationInput?.value || "").trim().toUpperCase();

      const oldPhone = String(
        currentUser?.phone ||
        currentUser?.user_metadata?.phone ||
        profile.phone ||
        ""
      ).trim();

      const cleanPhone = String(phone).trim();

      if(saveProfileBtn) saveProfileBtn.disabled = true;
      if(editProfileStatus){
        editProfileStatus.textContent = "Saving name...";
        editProfileStatus.className = "small muted";
      }

      try{
        // Name and vehicle registration can be changed immediately.
        await updateOwnProfileName(name);

        if(!vehicleRegistrationNumber || vehicleRegistrationNumber.length < 4 || vehicleRegistrationNumber.length > 20){
          throw new Error("Enter a valid vehicle registration number.");
        }

        const { data: updatedVehicleProfile, error: vehicleProfileError } = await supabase
          .from("profiles")
          .update({ vehicle_registration_number: vehicleRegistrationNumber })
          .eq("id", currentUser.id)
          .select("id,full_name,phone,role,vehicle_type,vehicle_registration_number,is_online")
          .maybeSingle();

        if(vehicleProfileError){
          throw new Error(vehicleProfileError.message || "Could not update the vehicle registration number.");
        }

        if(!updatedVehicleProfile){
          throw new Error("Your vehicle registration number could not be updated.");
        }

        // Phone changes are never written directly to profiles.
        // Supabase sends an OTP to the new number first.
        if(cleanPhone && cleanPhone !== oldPhone){
          pendingPhoneChange = cleanPhone;

          await requestDriverRiderPhoneChange(cleanPhone);

          if(phoneOtpSection) phoneOtpSection.hidden = false;
          if(phoneOtpStatus){
            phoneOtpStatus.textContent =
              "A verification code was sent to the new phone number. Verify it to finish the change.";
            phoneOtpStatus.className = "small muted";
          }
          if(editProfileStatus){
            editProfileStatus.textContent =
              "Name saved. Your phone number still needs OTP verification.";
            editProfileStatus.className = "small muted";
          }
          phoneOtpInput?.focus();
        }else{
          if(editProfileStatus){
            editProfileStatus.textContent = "Profile updated successfully.";
            editProfileStatus.className = "small";
          }

          if(editProfileForm) editProfileForm.hidden = true;
          if(editProfileBtn) editProfileBtn.hidden = false;

          setStatus($("dashboardStatus"), "Profile updated successfully.", "good");
          await loadDriverProfileDetails();
        }

      }catch(error){
        console.error("Edit profile error:", error);
        if(editProfileStatus){
          editProfileStatus.textContent = error.message || "Could not update your profile.";
          editProfileStatus.className = "small bad";
        }
        setStatus($("dashboardStatus"), error.message || "Could not update your profile.", "bad");
      }finally{
        if(saveProfileBtn) saveProfileBtn.disabled = false;
      }
    });

    verifyPhoneBtn?.addEventListener("click", async () => {
      if(!pendingPhoneChange){
        if(phoneOtpStatus) phoneOtpStatus.textContent = "No phone change is waiting for verification.";
        return;
      }

      const otp = phoneOtpInput?.value || "";

      verifyPhoneBtn.disabled = true;
      if(phoneOtpStatus){
        phoneOtpStatus.textContent = "Verifying phone number...";
        phoneOtpStatus.className = "small muted";
      }

      try{
        await verifyDriverRiderPhoneChange(pendingPhoneChange, otp);

        if(phoneOtpStatus){
          phoneOtpStatus.textContent = "Phone number verified successfully.";
          phoneOtpStatus.className = "small";
        }

        pendingPhoneChange = null;
        if(phoneOtpSection) phoneOtpSection.hidden = true;
        if(phoneOtpInput) phoneOtpInput.value = "";
        if(editProfileForm) editProfileForm.hidden = true;
        if(editProfileBtn) editProfileBtn.hidden = false;

        setStatus($("dashboardStatus"), "Profile updated successfully.", "good");
        await loadDriverProfileDetails();

      }catch(error){
        console.error("Phone verification error:", error);
        if(phoneOtpStatus){
          phoneOtpStatus.textContent = error.message || "Phone verification failed.";
          phoneOtpStatus.className = "small bad";
        }
        setStatus($("dashboardStatus"), error.message || "Phone verification failed.", "bad");
      }finally{
        verifyPhoneBtn.disabled = false;
      }
    });

    cancelPhoneOtpBtn?.addEventListener("click", () => {
      pendingPhoneChange = null;
      if(phoneOtpSection) phoneOtpSection.hidden = true;
      if(phoneOtpInput) phoneOtpInput.value = "";
      if(phoneOtpStatus) phoneOtpStatus.textContent = "";

      const phoneInput = $("driverProfilePhone");
      if(phoneInput) phoneInput.value = profile.phone || "";

      if(editProfileStatus){
        editProfileStatus.textContent =
          "Phone change cancelled. Your previous verified number remains in your profile.";
        editProfileStatus.className = "small muted";
      }
    });

    removePictureBtn?.addEventListener("click", async () => {
      if(!confirm("Remove your profile picture?")) return;

      setStatus($("dashboardStatus"), "Removing profile picture...");
      try{
        await removeDriverRiderProfilePicture();
        setStatus($("dashboardStatus"), "Profile picture removed.", "good");
        await loadDriverProfileDetails();
      }catch(error){
        console.error(error);
        setStatus(
          $("dashboardStatus"),
          error.message || "Could not remove the profile picture.",
          "bad"
        );
      }
    });
  }catch(error){
    console.error("Profile load error:", error);
    container.innerHTML = '<div class="status bad">Could not load profile: ' + escapeHTML(error.message || "Unknown error") + '</div>';
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

  const normalizedProfileVehicle = normalizeVehicle(profile.vehicle_type);
  driverMapVehicleType = normalizedProfileVehicle;

  const info = vehicleInfo[normalizedProfileVehicle] || {};
  $("dashboardTitle").textContent = `${info.icon || ""} ${info.label || "Let's Go"} ${info.roleLabel || ""} Dashboard`;
  $("dashboardPerson").textContent = profile.full_name || currentUser.email || "";
  $("onlineToggle").checked = !!profile.is_online;
  $("onlineLabel").textContent = profile.is_online ? "Online — ready for ride requests" : "Offline";
  setStatus($("dashboardStatus"), "");

  showScreen("dashboardScreen");
  setDriverMapVisibility(false);
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
$("dashboardCurrentTab").addEventListener("click", () => setDashboardPanel("current"));
$("dashboardHistoryTab").addEventListener("click", () => setDashboardPanel("history"));
$("dashboardProfileTab").addEventListener("click", () => setDashboardPanel("profile"));
$("profileRefreshBtn").addEventListener("click", () => loadDriverProfileDetails());

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

