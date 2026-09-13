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
let selectedRating = 0;
let pendingRatingBooking = null;
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
let partnerLedgerCommissionRate = 15;

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

async function uploadPartnerDocument(file, prefix){
  if(!file) throw new Error(`Upload your ${prefix} document.`);
  const allowed = ["image/jpeg","image/png","application/pdf"];
  if(!allowed.includes(file.type)) throw new Error(`Use JPG, PNG or PDF for the ${prefix} document.`);
  if(file.size > 5 * 1024 * 1024) throw new Error(`${prefix} document must be 5 MB or smaller.`);
  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "bin";
  const path = `${currentUser.id}/${prefix.toLowerCase().replace(/\\s+/g,"-")}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("driver-documents").upload(path, file, { contentType:file.type, upsert:false });
  if(error) throw error;
  return path;
}

function validateAadhaar(value){
  return /^\\d{12}$/.test(String(value || "").replace(/\\s+/g,""));
}

function validatePan(value){
  return /^[A-Za-z]{5}\\d{4}[A-Za-z]$/.test(String(value || "").trim());
}

async function submitPartnerDocuments(application, docs){
  const licenseNumber = String(docs.licenseNumber || "").trim();
  const aadhaarNumber = String(docs.aadhaarNumber || "").replace(/\\s+/g,"");
  const panNumber = String(docs.panNumber || "").trim().toUpperCase();

  if(!licenseNumber) throw new Error("Enter your driving licence number.");
  if(!validateAadhaar(aadhaarNumber)) throw new Error("Enter a valid 12-digit Aadhaar number.");
  if(!validatePan(panNumber)) throw new Error("Enter a valid PAN number (for example ABCDE1234F).");

  const uploaded = [];
  try{
    const licensePath = await uploadPartnerDocument(docs.licenseFile, "licence"); uploaded.push(licensePath);
    const aadhaarPath = await uploadPartnerDocument(docs.aadhaarFile, "aadhaar"); uploaded.push(aadhaarPath);
    const panPath = await uploadPartnerDocument(docs.panFile, "pan"); uploaded.push(panPath);

    const { data, error } = await supabase
      .from("driver_rider_applications")
      .update({
        license_number: licenseNumber,
        license_file_path: licensePath,
        aadhaar_number: aadhaarNumber,
        aadhaar_file_path: aadhaarPath,
        pan_number: panNumber,
        pan_file_path: panPath,
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

    if(error) throw error;
    currentApplication = data;
    return data;
  }catch(error){
    if(uploaded.length) await supabase.storage.from("driver-documents").remove(uploaded).catch(()=>{});
    throw error;
  }
}

function renderVerification(app){
  const info = vehicleInfo[normalizeVehicle(app?.vehicle_type)] || {};
  let html = `
    <div class="row"><span>Service</span><strong>${info.icon || ""} ${info.label || "—"} ${info.roleLabel || ""}</strong></div>
    <div class="row"><span>Status</span><span class="pill">${statusLabel(app?.status)}</span></div>
    <div class="row"><span>Licence</span><strong>${app?.license_number ? "Submitted" : "Not submitted"}</strong></div>
    <div class="row"><span>Aadhaar</span><strong>${app?.aadhaar_number ? "Submitted" : "Not submitted"}</strong></div>
    <div class="row"><span>PAN</span><strong>${app?.pan_number ? "Submitted" : "Not submitted"}</strong></div>
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
    $("aadhaarNumber").value = app.aadhaar_number || "";
    $("panNumber").value = app.pan_number || "";
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
    // Approved partners should enter the full dashboard immediately.
    // They can remain offline and still view earnings, history and profile.
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
$("aadhaarFile").addEventListener("change", () => {
  const f = $("aadhaarFile").files?.[0];
  $("aadhaarFileName").textContent = f ? f.name : "JPG, PNG or PDF — maximum 5 MB.";
});
$("panFile").addEventListener("change", () => {
  const f = $("panFile").files?.[0];
  $("panFileName").textContent = f ? f.name : "JPG, PNG or PDF — maximum 5 MB.";
});
$("aadhaarNumber").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0,12); });
$("panNumber").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,10); });

$("registerBtn").addEventListener("click", async () => {
  const fullName = $("fullName").value.trim();
  const phone = $("phone").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;
  const licenseNumber = $("licenseNumber").value.trim();
  const licenseFile = $("licenseFile").files?.[0] || null;
  const aadhaarNumber = $("aadhaarNumber").value.trim();
  const aadhaarFile = $("aadhaarFile").files?.[0] || null;
  const panNumber = $("panNumber").value.trim().toUpperCase();
  const panFile = $("panFile").files?.[0] || null;

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
  if(!licenseNumber || !licenseFile){
    setStatus($("registerStatus"), "Driving licence number and licence document are required.", "bad"); return;
  }
  if(!validateAadhaar(aadhaarNumber) || !aadhaarFile){
    setStatus($("registerStatus"), "Enter a valid 12-digit Aadhaar number and upload the Aadhaar document.", "bad"); return;
  }
  if(!validatePan(panNumber) || !panFile){
    setStatus($("registerStatus"), "Enter a valid PAN number and upload the PAN document.", "bad"); return;
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
    await submitPartnerDocuments(app, {
      licenseNumber, licenseFile,
      aadhaarNumber, aadhaarFile,
      panNumber, panFile
    });

    $("licenseFile").value = "";
    $("aadhaarFile").value = "";
    $("panFile").value = "";
    $("fileName").textContent = "JPG, PNG or PDF — maximum 5 MB.";
    $("aadhaarFileName").textContent = "JPG, PNG or PDF — maximum 5 MB.";
    $("panFileName").textContent = "JPG, PNG or PDF — maximum 5 MB.";
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
    await initializeDriverMap();
    if(driverMap){
      clearDriverMapRoute();
      clearDriverMapMarkers();
      driverMapLivePosition = null;
      driverMapLastRoutePosition = null;
      driverMapLastRouteBookingId = null;
      driverMapLastRouteStatus = "";
      driverMap.setCenter({lat:20.5937,lng:78.9629});
      driverMap.setZoom(5);
      $("driverMapStatus").textContent = "No active ride. Your assigned ride map will appear here.";
    }
    return;
  }

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
    .select("id,full_name,phone,role,vehicle_type,is_online")
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

function renderDashboardBookings(){
  const list = $("driverBookingList");
  if(!list) return;

  if(!dashboardBookings.length){
    list.innerHTML = '<div class="status">No assigned ride requests right now.</div>';
    updateAvailabilityAndRequestMessage();
    return;
  }

  list.innerHTML = dashboardBookings.map(b => {
    const status = String(b.status || "").toLowerCase();
    let actions = "";
    if(status === "pending"){
      actions = '<div class="dashboard-actions"><button class="btn accept-booking" data-id="'+b.id+'">Accept Ride</button><button class="btn danger reject-booking" data-id="'+b.id+'">Reject Ride</button></div>';
    }else if(status === "accepted"){
      actions = '<div class="dashboard-actions"><button class="btn start-booking" data-id="'+b.id+'">Start Ride</button><button class="btn danger cancel-accepted-booking" data-id="'+b.id+'">Cancel Ride</button></div>';
    }else if(status === "in_progress"){
      actions = '<div class="dashboard-actions"><button class="btn complete-booking" data-id="'+b.id+'">Complete Ride</button></div>';
    }else if(status === "completed" && String(b.payment_method || "").toLowerCase() === "cash" && String(b.payment_status || "pending").toLowerCase() !== "paid"){
      actions = '<div class="dashboard-actions"><button class="btn cash-received-booking" data-id="'+b.id+'">Cash Received — Mark as Paid</button></div>';
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
  list.querySelectorAll(".cancel-accepted-booking").forEach(btn =>
    btn.addEventListener("click", () => cancelAcceptedBooking(btn.dataset.id)));
  list.querySelectorAll(".complete-booking").forEach(btn =>
    btn.addEventListener("click", () => updateAssignedBooking(btn.dataset.id, "completed")));
  list.querySelectorAll(".reject-booking").forEach(btn =>
    btn.addEventListener("click", () => rejectAssignedBooking(btn.dataset.id)));
  list.querySelectorAll(".cash-received-booking").forEach(btn =>
    btn.addEventListener("click", () => markCashPaymentReceived(btn.dataset.id)));

  updateAvailabilityAndRequestMessage();
}

async function loadDriverBookings(){
  if(!currentUser) return;
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("driver_id", currentUser.id)
    .in("status", ["pending","accepted","in_progress","completed"])
    .order("created_at", { ascending:false });

  if(error){
    console.error(error);
    setStatus($("dashboardStatus"), error.message || "Could not load ride requests.", "bad");
    return;
  }

  dashboardBookings = data || [];
  renderDashboardBookings();
  void loadDriverEarningsStats();
  void refreshDriverMapFromBookings();
  syncLiveLocationTracking();
  void promptForUnratedCompletedCustomer();
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


// ===== Nearby availability location publishing =====
// Publishes the partner's current GPS position while they are ONLINE.
// Active-ride tracking continues to use the existing ride_locations flow.
let availabilityWatchId = null;
let availabilityLocationTimer = null;
let availabilityLastCoords = null;

async function publishAvailabilityLocation(position) {
  if (!currentUser?.id || !position?.coords) return;

  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  availabilityLastCoords = { latitude, longitude };

  const { error } = await supabase
    .from("driver_rider_locations")
    .upsert({
      driver_id: currentUser.id,
      latitude,
      longitude,
      updated_at: new Date().toISOString()
    }, { onConflict: "driver_id" });

  if (error) {
    console.warn("Could not publish availability location:", error.message);
  }
}

function stopAvailabilityLocationPublishing() {
  if (availabilityWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(availabilityWatchId);
  }
  availabilityWatchId = null;

  if (availabilityLocationTimer) {
    clearInterval(availabilityLocationTimer);
    availabilityLocationTimer = null;
  }
}

function startAvailabilityLocationPublishing() {
  stopAvailabilityLocationPublishing();

  if (!navigator.geolocation || !currentUser?.id) return;

  const publish = () => {
    navigator.geolocation.getCurrentPosition(
      publishAvailabilityLocation,
      (err) => console.warn("Availability GPS error:", err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  };

  publish();

  // Keep the nearby-availability position fresh while online.
  availabilityLocationTimer = setInterval(publish, 15000);
}

async function clearAvailabilityLocation() {
  if (!currentUser?.id) return;

  const { error } = await supabase
    .from("driver_rider_locations")
    .delete()
    .eq("driver_id", currentUser.id);

  if (error) {
    console.warn("Could not clear availability location:", error.message);
  }

  availabilityLastCoords = null;
}


function updateOnlineAvailabilityText(isOnline){
  const hint = $("onlineHint");
  if(hint){
    hint.textContent = isOnline
      ? "You are online and available. No ride requests right now."
      : "You are offline. Turn on availability to receive ride requests.";
  }
  updateAvailabilityAndRequestMessage();
}


function updateAvailabilityAndRequestMessage(){
  const hint = $("onlineHint");
  if(!hint) return;

  const isOnline = !!$("onlineToggle")?.checked;
  const bookings = Array.isArray(dashboardBookings) ? dashboardBookings : [];
  const hasPending = bookings.some(b => String(b.status || "").toLowerCase() === "pending");
  const hasActive = bookings.some(b => ["accepted","in_progress"].includes(String(b.status || "").toLowerCase()));

  if(!isOnline){
    hint.textContent = "You are offline. Turn on availability to receive ride requests.";
  }else if(hasPending){
    hint.textContent = "New ride request available. Please review the booking below.";
  }else if(hasActive){
    hint.textContent = "You have an active ride. Manage the booking below.";
  }else{
    hint.textContent = "You are online and available. No ride requests right now.";
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
  updateOnlineAvailabilityText(!!data.is_online);
  setStatus($("dashboardStatus"),
    data.is_online ? "You are now online. Assigned ride requests will appear here." : "You are offline.",
    "ok");

  await loadDriverBookings();

    if (isOnline) {
      startAvailabilityLocationPublishing();
    } else {
      stopAvailabilityLocationPublishing();
      await clearAvailabilityLocation();
    }
}

function openCustomerRating(booking){
  pendingRatingBooking = booking;
  selectedRating = 0;
  $("ratingCard")?.classList.remove("hidden");
  $("ratingFeedback").value = "";
  $("ratingStatus")?.classList.add("hidden");
  document.querySelectorAll(".rating-star").forEach(b => b.classList.remove("active"));
  $("ratingCard")?.scrollIntoView({behavior:"smooth", block:"center"});
}

// Find a recently completed ride that this Driver/Rider has not rated yet.
// This is also called when the dashboard reloads, so the rating prompt is
// not dependent only on clicking the Complete Ride button in this session.
async function promptForUnratedCompletedCustomer(){
  if(!currentUser || pendingRatingBooking) return;

  try{
    const { data: completedRows, error: bookingsError } = await supabase
      .from("bookings")
      .select("*")
      .eq("driver_id", currentUser.id)
      .eq("status", "completed")
      .order("created_at", { ascending:false })
      .limit(20);

    if(bookingsError){
      console.error("Completed rides rating lookup error:", bookingsError);
      return;
    }

    const completed = Array.isArray(completedRows) ? completedRows : [];
    if(!completed.length) return;

    const bookingIds = completed.map(row => row.id).filter(Boolean);
    if(!bookingIds.length) return;

    const { data: existingRatings, error: ratingsError } = await supabase
      .from("ratings")
      .select("booking_id")
      .eq("rater_id", currentUser.id)
      .in("booking_id", bookingIds);

    if(ratingsError){
      console.error("Existing customer ratings lookup error:", ratingsError);
      return;
    }

    const ratedIds = new Set(
      (Array.isArray(existingRatings) ? existingRatings : [])
        .map(row => row.booking_id)
        .filter(Boolean)
    );

    const unrated = completed.find(row => !ratedIds.has(row.id));
    if(unrated && unrated.user_id){
      openCustomerRating(unrated);
    }
  }catch(error){
    console.error("Could not find an unrated completed ride:", error);
  }
}

async function submitCustomerRating(){
  if(!currentUser || !pendingRatingBooking || !selectedRating){
    setStatus($("ratingStatus"), "Please select a rating first.", "bad");
    return;
  }
  const ratedUserId = pendingRatingBooking.user_id;
  if(!ratedUserId || ratedUserId === currentUser.id){
    setStatus($("ratingStatus"), "Customer information is unavailable for this rating.", "bad");
    return;
  }
  const feedback = String($("ratingFeedback")?.value || "").trim() || null;
  const { error } = await supabase.from("ratings").insert({
    booking_id: pendingRatingBooking.id, rater_id: currentUser.id, rated_user_id: ratedUserId, rating: selectedRating, feedback
  });
  if(error){
    console.error("Customer rating error:", error);
    setStatus($("ratingStatus"), error.code === "23505" ? "You already rated this customer for this ride." : (error.message || "Could not submit rating."), "bad");
    return;
  }
  setStatus($("ratingStatus"), "Thank you. Your anonymous rating was submitted.", "good");
  setTimeout(() => $("ratingCard")?.classList.add("hidden"), 1200);
  pendingRatingBooking = null;
}

async function markCashPaymentReceived(bookingId){
  if(!currentUser) return;
  const booking = dashboardBookings.find(x => x.id === bookingId);
  if(!booking) return;
  if(String(booking.status || "").toLowerCase() !== "completed" || String(booking.payment_method || "").toLowerCase() !== "cash") return;
  if(String(booking.payment_status || "pending").toLowerCase() === "paid") return;

  const amount = Number(booking.fare_amount ?? booking.fare ?? 0);
  const confirmed = window.confirm(`Confirm that you received ₹${Number.isFinite(amount) ? amount.toFixed(2).replace(/\.00$/, "") : "the cash amount"} from the customer?`);
  if(!confirmed) return;

  try{
    const { data, error } = await supabase
      .from("bookings")
      .update({ payment_status: "paid" })
      .eq("id", bookingId)
      .eq("driver_id", currentUser.id)
      .eq("status", "completed")
      .eq("payment_method", "cash")
      .neq("payment_status", "paid")
      .select("id,payment_status")
      .maybeSingle();

    if(error) throw error;
    if(!data){
      throw new Error("Cash payment was not updated. The ride may already be marked as paid or is not assigned to you.");
    }
    setStatus($("dashboardStatus"), "Cash payment marked as paid. The customer will now see Payment: Paid.", "ok");
    await loadDriverBookings();
  }catch(err){
    console.error("Cash payment update error:", err);
    setStatus($("dashboardStatus"), err.message || "Could not mark cash payment as paid.", "bad");
    await loadDriverBookings();
  }
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
      openCustomerRating(booking);
    }

    await loadDriverBookings();
    void loadPartnerEarningsLedger();
  }catch(err){
    console.error(err);
    setStatus($("dashboardStatus"), err.message || "Could not update the ride.", "bad");
    await loadDriverBookings();
  }
}



async function cancelAcceptedBooking(bookingId){
  if(!currentUser) return;
  const booking = dashboardBookings.find(x => x.id === bookingId);
  if(!booking || String(booking.status || "").toLowerCase() !== "accepted") return;

  const confirmed = window.confirm(
    "Cancel this accepted ride? The booking will be sent to another available driver/rider."
  );
  if(!confirmed) return;

  try{
    const { error } = await supabase.rpc("cancel_accepted_booking_and_reassign", {
      p_booking_id: bookingId
    });
    if(error) throw error;

    stopLiveLocationTracking();
    setStatus(
      $("dashboardStatus"),
      "Ride cancelled. Let's Go is finding another available driver/rider.",
      "ok"
    );
    await loadDriverBookings();
  }catch(err){
    console.error("Driver/Rider cancellation error:", err);
    setStatus(
      $("dashboardStatus"),
      err.message || "Could not cancel the accepted ride.",
      "bad"
    );
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

function driverISTDateKey(value){
  if(!value) return "";
  try{
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone:"Asia/Kolkata",
      year:"numeric",
      month:"2-digit",
      day:"2-digit"
    }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }catch(error){
    console.warn("Could not format Driver/Rider date:", error);
    return "";
  }
}

function driverTodayKey(){
  return driverISTDateKey(new Date().toISOString());
}

function driverPeriodStartKey(period){
  const today = driverTodayKey();
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

function driverBookingInPeriod(booking, period){
  const key = driverISTDateKey(booking?.created_at);
  if(!key) return false;
  const start = driverPeriodStartKey(period);
  return key >= start && key <= driverTodayKey();
}


function formatLedgerMoney(value){
  const n = Number(value);
  return `₹${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function ledgerStatusLabel(status){
  return ({pending:"Pending",paid:"Paid",cancelled:"Cancelled",legacy_unreconciled:"Historical / Unreconciled"})[String(status||"").toLowerCase()] || "Pending";
}

async function loadPartnerEarningsLedger(){
  if(!currentUser) return;
  const history = $("partnerPayoutHistory");
  if(history) history.innerHTML = '<div class="status">Loading payout history...</div>';

  // Do not read financial settings from the Driver/Rider browser.
  // That table contains platform configuration and is not needed to
  // display partner earnings. The earnings ledger already stores the
  // actual platform fee percentage and amounts for each completed ride.

  const { data, error } = await supabase
    .from("partner_earnings_ledger")
    .select("id,booking_id,gross_fare,platform_fee_percent,platform_fee,partner_earnings,payout_status,payout_id,payment_method,earned_at,paid_at")
    .eq("partner_id", currentUser.id)
    .order("earned_at", { ascending:false });

  if(error){
    console.error("Partner earnings ledger error:", error);
    if(history) history.innerHTML = '<div class="status bad">Could not load earnings ledger: ' + escapeHTML(error.message || "Unknown error") + '</div>';
    return;
  }

  const rows = data || [];

  // Use the fee percentage stored on the partner's ledger rows.
  // Keep 15% only as a display fallback when there are no ledger rows.
  const firstRate = rows.find(r => Number.isFinite(Number(r.platform_fee_percent)))?.platform_fee_percent;
  partnerLedgerCommissionRate = Number(firstRate);
  if(!Number.isFinite(partnerLedgerCommissionRate)) partnerLedgerCommissionRate = 15;

  const rateEl = $("partnerCommissionRate");
  if(rateEl) rateEl.textContent = `Platform fee: ${partnerLedgerCommissionRate.toFixed(2)}%`;

  const gross = rows.reduce((sum,r)=>sum + (Number.isFinite(Number(r.gross_fare)) ? Number(r.gross_fare) : 0),0);
  const fee = rows.reduce((sum,r)=>sum + (Number.isFinite(Number(r.platform_fee)) ? Number(r.platform_fee) : 0),0);
  const net = rows.reduce((sum,r)=>sum + (Number.isFinite(Number(r.partner_earnings)) ? Number(r.partner_earnings) : 0),0);
  const pending = rows.filter(r=>String(r.payout_status||"").toLowerCase()==="pending").reduce((sum,r)=>sum + (Number.isFinite(Number(r.partner_earnings)) ? Number(r.partner_earnings) : 0),0);

  if($("partnerGrossEarnings")) $("partnerGrossEarnings").textContent = formatLedgerMoney(gross);
  if($("partnerPlatformFee")) $("partnerPlatformFee").textContent = formatLedgerMoney(fee);
  if($("partnerNetEarnings")) $("partnerNetEarnings").textContent = formatLedgerMoney(net);
  if($("partnerPendingPayout")) $("partnerPendingPayout").textContent = formatLedgerMoney(pending);

  if(!history) return;
  if(!rows.length){
    history.innerHTML = '<div class="status">No payout records yet. Completed rides will appear here after they are added to the earnings ledger.</div>';
    return;
  }

  history.innerHTML = rows.slice(0,20).map(r=>{
    const status = String(r.payout_status||"pending").toLowerCase();
    const date = r.earned_at ? new Date(r.earned_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}) : "—";
    return `<div class="payout-row">
      <div class="payout-row-top"><strong>${formatLedgerMoney(r.partner_earnings)}</strong><span class="payout-status">${escapeHTML(ledgerStatusLabel(status))}</span></div>
      <div class="payout-row-meta"><span>Gross ${formatLedgerMoney(r.gross_fare)}</span><span>Fee ${formatLedgerMoney(r.platform_fee)}</span><span>${escapeHTML(String(r.payment_method || "Payment not specified"))}</span><span>${escapeHTML(date)}</span>${r.payout_id ? `<span>Payout: ${escapeHTML(r.payout_id)}</span>` : ""}</div>
    </div>`;
  }).join("");
}

async function loadDriverEarningsStats(){
  if(!currentUser) return;
  const container = $("driverEarningsStats");
  if(!container) return;

  container.innerHTML = '<div class="status">Loading your earnings...</div>';

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id,status,created_at")
    .eq("driver_id", currentUser.id)
    .eq("status", "completed")
    .order("created_at", { ascending:false });

  if(bookingsError){
    console.error("Driver ride count error:", bookingsError);
    container.innerHTML = '<div class="status bad">Could not load earnings: ' + escapeHTML(bookingsError.message || "Unknown error") + '</div>';
    return;
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("partner_earnings_ledger")
    .select("booking_id,partner_earnings,earned_at")
    .eq("partner_id", currentUser.id)
    .order("earned_at", { ascending:false });

  if(ledgerError){
    console.error("Driver ledger stats error:", ledgerError);
    container.innerHTML = '<div class="status bad">Could not load earnings ledger: ' + escapeHTML(ledgerError.message || "Unknown error") + '</div>';
    return;
  }

  const rows = ledgerRows || [];
  const totalEarnings = rows.reduce((sum, r) => {
    const value = Number(r.partner_earnings);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const totalEarningsEl = $("driverTotalEarnings");
  const totalRidesEl = $("driverTotalRides");
  if(totalEarningsEl) totalEarningsEl.textContent = `₹${totalEarnings.toFixed(2)}`;
  if(totalRidesEl) totalRidesEl.textContent = String((bookings || []).length);

  const periods = [
    { key:"today", label:"Today" },
    { key:"week", label:"This Week" },
    { key:"month", label:"This Month" }
  ];

  container.innerHTML = periods.map(period => {
    const periodRows = rows.filter(r => driverBookingInPeriod({created_at:r.earned_at}, period.key));
    const earnings = periodRows.reduce((sum, r) => {
      const value = Number(r.partner_earnings);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    const rideIds = new Set(periodRows.map(r => r.booking_id).filter(Boolean));

    return `
      <div class="driver-earnings-period">
        <div class="period-label">${period.label}</div>
        <div class="driver-earnings-stat"><span>Total rides</span><strong>${rideIds.size}</strong></div>
        <div class="driver-earnings-stat"><span>Your earnings</span><strong>₹${earnings.toFixed(2)}</strong></div>
      </div>
    `;
  }).join("");
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
    void loadDriverMyRating();
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
    .select("id,full_name,phone,role,vehicle_type,is_online")
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
    .select("id,full_name,phone,role,vehicle_type,is_online")
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


async function loadDriverMyRating(){
  const container = $("driverMyRatingContent");
  if(!container || !currentUser) return;

  container.innerHTML = '<div class="status">Loading your rating...</div>';

  try{
    const result = await supabase
      .from("ratings")
      .select("rating")
      .eq("rated_user_id", currentUser.id);

    if(result.error){
      console.error("Driver/Rider rating query error:", result.error);
      container.innerHTML =
        '<div class="status bad">Rating service error: ' +
        escapeHTML(result.error.message || result.error.code || "Unknown database error") +
        '</div>';
      return;
    }

    const ratings = Array.isArray(result.data)
      ? result.data.map(row => Number(row.rating)).filter(n => n >= 1 && n <= 5)
      : [];

    if(!ratings.length){
      container.innerHTML = `
        <div style="text-align:center;padding:14px 0">
          <div style="font-size:30px;font-weight:900">— <span aria-hidden="true">⭐</span></div>
          <div class="muted small" style="margin-top:8px">No ratings received yet.</div>
        </div>
        <p class="notice">Your overall rating will appear here after customers rate your completed rides.</p>
      `;
      return;
    }

    const count = ratings.length;
    const average = (ratings.reduce((sum, n) => sum + n, 0) / count).toFixed(1);
    const rounded = Math.max(0, Math.min(5, Math.round(Number(average))));
    const stars = "★".repeat(rounded) + "☆".repeat(5 - rounded);

    container.innerHTML = `
      <div style="text-align:center;padding:10px 0 4px">
        <div style="font-size:30px;font-weight:900">${escapeHTML(average)} <span aria-hidden="true">⭐</span></div>
        <div style="font-size:22px;letter-spacing:2px;margin-top:4px">${stars}</div>
        <div class="muted small" style="margin-top:8px">${count} rating${count === 1 ? "" : "s"} received</div>
      </div>
      <p class="notice">Ratings are anonymous. Individual customer identities and comments are not shown.</p>
    `;
  }catch(error){
    console.error("Driver/Rider rating load exception:", error);
    container.innerHTML =
      '<div class="status bad">Rating service error: ' +
      escapeHTML(error?.message || "Unknown error") +
      '</div>';
  }
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
      const name = nameInput?.value || "";
      const phone = phoneInput?.value || "";

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
        // Name can be changed immediately.
        await updateOwnProfileName(name);

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
  await initializeDriverMap();
  await loadDriverBookings();
  void loadDriverEarningsStats();
  void loadPartnerEarningsLedger();
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
document.querySelectorAll(".rating-star").forEach(btn => btn.addEventListener("click", () => {
  selectedRating = Number(btn.dataset.rating || 0);
  document.querySelectorAll(".rating-star").forEach(star => star.classList.toggle("active", Number(star.dataset.rating) === selectedRating));
}));
$("submitRatingBtn")?.addEventListener("click", submitCustomerRating);

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




$("driverStatsRefreshBtn")?.addEventListener("click", () => {
  void loadDriverEarningsStats();
  void loadPartnerEarningsLedger();
});


window.addEventListener("beforeunload", () => {
  stopAvailabilityLocationPublishing();
});


