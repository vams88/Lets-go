import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  GOOGLE_MAPS_API_KEY
} from "./config.js";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
// ============================================================
// GOOGLE MAPS + PLACE AUTOCOMPLETE (NEW)
// ============================================================

let letsGoMap = null;
let pickupMarker = null;
let destinationMarker = null;
let placesLibrary = null;
let pickupAutocompleteSession = null;
let destinationAutocompleteSession = null;
let pickupSuggestionRequestId = 0;
let destinationSuggestionRequestId = 0;
let locationAutocompleteReady = false;

function addLocationAutocompleteStyles() {

  if (document.getElementById("letsGoLocationAutocompleteStyles")) {
    return;
  }

  const style = document.createElement("style");

  style.id = "letsGoLocationAutocompleteStyles";

  style.textContent = `
    .lets-go-location-field {
      position: relative;
    }

    .lets-go-location-suggestions {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      z-index: 10000;
      margin-top: 6px;
      padding: 6px 0 0;
      background: #ffffff;
      border: 1px solid #d9d9df;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
      overflow: hidden;
    }

    .lets-go-location-suggestion {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 12px 14px;
      border: 0;
      border-bottom: 1px solid #eeeeF2;
      background: #ffffff;
      color: #171722;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .lets-go-location-suggestion:last-of-type {
      border-bottom: 0;
    }

    .lets-go-location-suggestion:hover,
    .lets-go-location-suggestion:focus {
      background: #f5f3ff;
      outline: none;
    }

    .lets-go-location-suggestion-main {
      font-weight: 700;
      font-size: 15px;
      line-height: 1.25;
    }

    .lets-go-location-suggestion-secondary {
      color: #6b6b75;
      font-size: 13px;
      line-height: 1.25;
    }

    .lets-go-location-google-attribution {
      padding: 7px 12px 8px;
      color: #6b6b75;
      background: #fafafa;
      border-top: 1px solid #eeeeF2;
      font-size: 11px;
      text-align: right;
    }
  `;

  document.head.appendChild(style);

}

function getPredictionText(formattableText) {

  if (!formattableText) {
    return "";
  }

  return (
    formattableText.text ||
    formattableText.toString() ||
    ""
  );

}

function clearLocationSuggestions(field) {

  const container =
    field?.parentElement?.querySelector(
      ".lets-go-location-suggestions"
    );

  if (container) {
    container.remove();
  }

}

function createLocationSuggestionsContainer(field) {

  clearLocationSuggestions(field);

  const container =
    document.createElement("div");

  container.className =
    "lets-go-location-suggestions";

  container.setAttribute("role", "listbox");

  field.parentElement.appendChild(container);

  return container;

}

async function selectLocationPrediction(
  field,
  prediction,
  type
) {

  clearLocationSuggestions(field);

  const fallbackText =
    getPredictionText(prediction?.text);

  if (fallbackText) {
    field.value = fallbackText;
  }

  try {

    const place =
      prediction?.toPlace?.();

    if (!place) {
      return;
    }

    await place.fetchFields({
      fields: [
        "displayName",
        "formattedAddress",
        "location",
        "viewport"
      ]
    });

    const address =
      place.formattedAddress ||
      place.displayName ||
      fallbackText ||
      "";

    if (address) {
      field.value = address;
    }

    if (place.location) {
      updateLocationOnMap(
        place.location,
        type,
        place.viewport
      );
    }

    if (type === "pickup") {
      pickupAutocompleteSession = null;
    } else {
      destinationAutocompleteSession = null;
    }

  } catch (error) {

    console.error(
      "Google place selection error:",
      error
    );

  }

}

async function showLocationSuggestions(
  field,
  type
) {

  if (!placesLibrary || !field) {
    return;
  }

  const input =
    field.value.trim();

  const requestId =
    type === "pickup"
      ? ++pickupSuggestionRequestId
      : ++destinationSuggestionRequestId;

  if (input.length < 2) {
    clearLocationSuggestions(field);
    return;
  }

  if (type === "pickup" && !pickupAutocompleteSession) {
    pickupAutocompleteSession =
      new placesLibrary.AutocompleteSessionToken();
  }

  if (type === "destination" && !destinationAutocompleteSession) {
    destinationAutocompleteSession =
      new placesLibrary.AutocompleteSessionToken();
  }

  const sessionToken =
    type === "pickup"
      ? pickupAutocompleteSession
      : destinationAutocompleteSession;

  const request = {
    input,
    includedRegionCodes: ["in"],
    language: "en",
    region: "IN",
    sessionToken
  };

  if (letsGoMap) {
    const center = letsGoMap.getCenter();

    if (center) {
      request.locationBias = {
        center,
        radius: 50000
      };
    }
  }

  try {

    const result =
      await placesLibrary.AutocompleteSuggestion
        .fetchAutocompleteSuggestions(request);

    if (requestId !== (
      type === "pickup"
        ? pickupSuggestionRequestId
        : destinationSuggestionRequestId
    )) {
      return;
    }

    clearLocationSuggestions(field);

    const suggestions =
      (result?.suggestions || [])
        .filter(
          suggestion => suggestion?.placePrediction
        )
        .slice(0, 6);

    if (suggestions.length === 0) {
      return;
    }

    const container =
      createLocationSuggestionsContainer(field);

    for (const suggestion of suggestions) {

      const prediction =
        suggestion.placePrediction;

      const button =
        document.createElement("button");

      button.type = "button";
      button.className =
        "lets-go-location-suggestion";
      button.setAttribute("role", "option");

      const main =
        document.createElement("span");

      main.className =
        "lets-go-location-suggestion-main";

      main.textContent =
        getPredictionText(
          prediction.mainText
        ) ||
        getPredictionText(
          prediction.text
        );

      const secondary =
        document.createElement("span");

      secondary.className =
        "lets-go-location-suggestion-secondary";

      secondary.textContent =
        getPredictionText(
          prediction.secondaryText
        );

      button.appendChild(main);

      if (secondary.textContent) {
        button.appendChild(secondary);
      }

      button.addEventListener(
        "click",
        () => {
          void selectLocationPrediction(
            field,
            prediction,
            type
          );
        }
      );

      container.appendChild(button);

    }

    const attribution =
      document.createElement("div");

    attribution.className =
      "lets-go-location-google-attribution";

    attribution.textContent =
      "Powered by Google";

    container.appendChild(attribution);

  } catch (error) {

    if (requestId !== (
      type === "pickup"
        ? pickupSuggestionRequestId
        : destinationSuggestionRequestId
    )) {
      return;
    }

    console.error(
      "Google location suggestions error:",
      error
    );

    clearLocationSuggestions(field);

  }

}

function setupLocationAutocomplete() {

  if (locationAutocompleteReady) {
    return;
  }

  const pickupInput =
    document.getElementById("pickup");

  const destinationInput =
    document.getElementById("destination");

  if (!pickupInput || !destinationInput) {
    return;
  }

  addLocationAutocompleteStyles();

  pickupInput.parentElement.classList.add(
    "lets-go-location-field"
  );

  destinationInput.parentElement.classList.add(
    "lets-go-location-field"
  );

  let pickupTimer = null;
  let destinationTimer = null;

  pickupInput.addEventListener(
    "input",
    () => {
      if (pickupInput.value.trim().length === 0) {
        pickupAutocompleteSession = null;
      }
      clearTimeout(pickupTimer);
      pickupTimer = setTimeout(() => {
        void showLocationSuggestions(
          pickupInput,
          "pickup"
        );
      }, 250);
    }
  );

  destinationInput.addEventListener(
    "input",
    () => {
      if (destinationInput.value.trim().length === 0) {
        destinationAutocompleteSession = null;
      }
      clearTimeout(destinationTimer);
      destinationTimer = setTimeout(() => {
        void showLocationSuggestions(
          destinationInput,
          "destination"
        );
      }, 250);
    }
  );

  pickupInput.addEventListener(
    "focus",
    () => {
      if (pickupInput.value.trim().length >= 2) {
        void showLocationSuggestions(
          pickupInput,
          "pickup"
        );
      }
    }
  );

  destinationInput.addEventListener(
    "focus",
    () => {
      if (destinationInput.value.trim().length >= 2) {
        void showLocationSuggestions(
          destinationInput,
          "destination"
        );
      }
    }
  );

  pickupInput.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        clearLocationSuggestions(pickupInput);
      }
    }
  );

  destinationInput.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        clearLocationSuggestions(destinationInput);
      }
    }
  );

  document.addEventListener(
    "click",
    event => {
      if (!pickupInput.parentElement.contains(event.target)) {
        clearLocationSuggestions(pickupInput);
      }

      if (!destinationInput.parentElement.contains(event.target)) {
        clearLocationSuggestions(destinationInput);
      }
    }
  );

  locationAutocompleteReady = true;

}

function updateLocationOnMap(
  location,
  type,
  viewport = null
) {

  if (!letsGoMap) {
    return;
  }

  if (type === "pickup") {

    if (pickupMarker) {
      pickupMarker.setMap(null);
    }

    pickupMarker =
      new google.maps.Marker({
        position: location,
        map: letsGoMap,
        title: "Pickup"
      });

  }

  if (type === "destination") {

    if (destinationMarker) {
      destinationMarker.setMap(null);
    }

    destinationMarker =
      new google.maps.Marker({
        position: location,
        map: letsGoMap,
        title: "Destination"
      });

  }

  const bounds =
    new google.maps.LatLngBounds();

  if (pickupMarker) {
    bounds.extend(
      pickupMarker.getPosition()
    );
  }

  if (destinationMarker) {
    bounds.extend(
      destinationMarker.getPosition()
    );
  }

  if (
    pickupMarker &&
    destinationMarker
  ) {

    letsGoMap.fitBounds(bounds);

  } else if (viewport) {

    letsGoMap.fitBounds(viewport);

  } else {

    letsGoMap.panTo(location);
    letsGoMap.setZoom(15);

  }

}

// ------------------------------------------------------------
// LOAD GOOGLE MAPS
// ------------------------------------------------------------

function loadGoogleMaps() {

  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {

    if (!GOOGLE_MAPS_API_KEY) {

      reject(
        new Error(
          "Google Maps API key is missing from config.js."
        )
      );

      return;
    }

    const existingScript =
      document.querySelector(
        'script[data-lets-go-google-maps="true"]'
      );

    if (existingScript) {

      if (window.google?.maps?.importLibrary) {
        resolve();
        return;
      }

      const previousCallback =
        window.__letsGoGoogleMapsReady;

      window.__letsGoGoogleMapsReady = () => {
        if (typeof previousCallback === "function") {
          previousCallback();
        }
        resolve();
      };

      existingScript.addEventListener(
        "error",
        () =>
          reject(
            new Error(
              "Google Maps could not be loaded."
            )
          ),
        { once: true }
      );

      return;
    }

    const callbackName =
      "__letsGoGoogleMapsReady";

    window[callbackName] = () => {

      if (typeof window.__letsGoGoogleMapsReadyResolver === "function") {
        window.__letsGoGoogleMapsReadyResolver();
      }

    };

    window.__letsGoGoogleMapsReadyResolver = () => {
      resolve();
      delete window.__letsGoGoogleMapsReadyResolver;
    };

    const script =
      document.createElement("script");

    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(GOOGLE_MAPS_API_KEY) +
      "&loading=async&libraries=places&callback=" +
      callbackName;

    script.async = true;
    script.defer = true;

    script.dataset.letsGoGoogleMaps =
      "true";

    script.onerror = () => {

      delete window.__letsGoGoogleMapsReadyResolver;

      reject(
        new Error(
          "Google Maps failed to load. Check your API key and Google Cloud settings."
        )
      );

    };

    document.head.appendChild(script);

  });

}

// ------------------------------------------------------------
// INITIALIZE LET'S GO MAP
// ------------------------------------------------------------

async function initializeLetsGoMap() {

  const mapElement =
    document.getElementById("map");

  if (!mapElement) {
    return;
  }

  try {

    await loadGoogleMaps();

    placesLibrary =
      await google.maps.importLibrary("places");

  } catch (error) {

    console.error(
      "Google Maps loading error:",
      error
    );

    mapElement.innerHTML = `
      <div
        style="
          height:100%;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:20px;
          text-align:center;
        "
      >
        <div>
          <strong>Map could not be loaded.</strong>
          <p>
            Check your Google Maps API key and Google Cloud API settings.
          </p>
        </div>
      </div>
    `;

    return;
  }

  if (letsGoMap) {

    google.maps.event.trigger(
      letsGoMap,
      "resize"
    );

    setupLocationAutocomplete();

    return;

  }

  const mapsLibrary =
    await google.maps.importLibrary("maps");

  const MapClass =
    mapsLibrary?.Map || google.maps.Map;

  letsGoMap =
    new MapClass(
      mapElement,
      {
        center: {
          lat: 20.5937,
          lng: 78.9629
        },

        zoom: 5,

        mapTypeControl: false,

        streetViewControl: false,

        fullscreenControl: true,

        gestureHandling: "greedy"
      }
    );

  setupLocationAutocomplete();

}

// ============================================================
// ACCOUNT ELEMENTS
// ============================================================

const fullName =
  document.getElementById("fullName");

const accountPhone =
  document.getElementById("accountPhone");

const email =
  document.getElementById("email");

const password =
  document.getElementById("password");

const signupEmail =
  document.getElementById("signupEmail");

const signupPassword =
  document.getElementById("signupPassword");

const loginBtn =
  document.getElementById("loginBtn");

const signupBtn =
  document.getElementById("signupBtn");

const profileLogoutBtn =
  document.getElementById("profileLogoutBtn");

const showSignupBtn =
  document.getElementById("showSignupBtn");

const showLoginBtn =
  document.getElementById("showLoginBtn");

const loginMode =
  document.getElementById("loginMode");

const signupMode =
  document.getElementById("signupMode");

const authBox =
  document.getElementById("authBox");

const loggedInBox =
  document.getElementById("loggedInBox");

const authStatus =
  document.getElementById("authStatus");

const authMessage =
  document.getElementById("authMessage");

const userEmail =
  document.getElementById("userEmail");

// IMPORTANT:
// These elements were previously used without declarations.

const togglePasswordBtn =
  document.getElementById("togglePasswordBtn");

const forgotPasswordBtn =
  document.getElementById("forgotPasswordBtn");
  // ============================================================
// GOOGLE AUTHENTICATION
// ============================================================

const googleAuthBtns =
  document.querySelectorAll(".google-auth-btn");

// ============================================================
// HEADER AUTHENTICATION BUTTONS
// ============================================================

const headerLoginBtn =
  document.getElementById("headerLoginBtn");

const headerSignupBtn =
  document.getElementById("headerSignupBtn");

const landingLoginBtn =
  document.getElementById("landingLoginBtn");

const landingSignupBtn =
  document.getElementById("landingSignupBtn");

// ============================================================
// HOME / ACCOUNT VISIBILITY
// ============================================================

const homeSection =
  document.getElementById("home");

const accountSection =
  document.getElementById("account");


// ============================================================
// CUSTOMER NAVIGATION
// ============================================================

const bookNav =
  document.getElementById("bookNav");

const ridesNav =
  document.getElementById("ridesNav");

const bookSection =
  document.getElementById("book");

const ridesSection =
  document.getElementById("rides");

const homeBookBtn =
  document.getElementById("homeBookBtn");

const homeRideMessage =
  document.getElementById("homeRideMessage");

// ============================================================
// BOOKING ELEMENTS
// ============================================================

const pickup =
  document.getElementById("pickup");

const destination =
  document.getElementById("destination");

const rideType =
  document.getElementById("rideType");

const bookBtn =
  document.getElementById("bookBtn");

const status =
  document.getElementById("status");

const list =
  document.getElementById("list");

// ============================================================
// APP LOADING / NAVIGATION STATE
// ============================================================

// Prevent overlapping authentication refreshes.
let authUIUpdatePromise = null;

// Current authenticated user/role used by the mobile navigation.
// The navigation must not depend on another auth request after login.
let currentAuthUser = null;
let currentAppRole = null;

const ACTIVE_RIDE_STATUSES = [
  "pending",
  "accepted",
  "in_progress"
];

// ============================================================
// CUSTOMER CONTACT LOOKUP
// Phone numbers are never taken from booking-form input.
// The booking's user_id identifies the customer, and the
// customer's phone is read from that customer's profile.
// ============================================================

async function loadCustomerProfiles(bookings) {

  const customerIds = [
    ...new Set(
      (bookings || [])
        .map(booking => booking?.user_id)
        .filter(Boolean)
    )
  ];

  if (customerIds.length === 0) {
    return {};
  }

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone"
    )
    .in(
      "id",
      customerIds
    );

  if (error) {

    console.error(
      "Customer profile lookup error:",
      error
    );

    return {};
  }

  return Object.fromEntries(
    (data || []).map(
      profile => [
        profile.id,
        profile
      ]
    )
  );
}

// ============================================================
// ADMIN ELEMENTS
// ============================================================

const adminNav =
  document.getElementById("adminNav");

const adminSection =
  document.getElementById("admin");

const adminStatus =
  document.getElementById("adminStatus");

const adminList =
  document.getElementById("adminList");

// ============================================================
// DRIVER ELEMENTS
// ============================================================

const driverNav =
  document.getElementById("driverNav");

const driverSection =
  document.getElementById("driver");

const driverOnlineBtn =
  document.getElementById("driverOnlineBtn");

const driverOnlineStatus =
  document.getElementById("driverOnlineStatus");

// ============================================================
// RIDER ELEMENTS
// ============================================================

const riderNav =
  document.getElementById("riderNav");

const riderSection =
  document.getElementById("rider");

const riderList =
  document.getElementById("riderList");

const riderOnlineBtn =
  document.getElementById("riderOnlineBtn");

const riderOnlineStatus =
  document.getElementById("riderOnlineStatus");

// ============================================================
// LOGIN / SIGNUP MODE
// ============================================================

function showLoginMode() {

  loginMode?.classList.remove("hidden");

  signupMode?.classList.add("hidden");

  if (authStatus) {
    authStatus.textContent = "";
  }

}

function showSignupMode() {

  loginMode?.classList.add("hidden");

  signupMode?.classList.remove("hidden");

  if (authStatus) {
    authStatus.textContent = "";
  }

}

// ============================================================
// UPDATE HEADER AUTHENTICATION BUTTONS
// ============================================================

function updateHeaderAuthUI(isLoggedIn) {

  if (isLoggedIn) {

    // Logout belongs ONLY on the Profile screen.
    // Never place a logout action in the header or Ride screen.
    headerLoginBtn?.classList.add("hidden");

    headerSignupBtn?.classList.add("hidden");

  } else {

    // Logged-out visitors see Log In / Sign Up.
    headerLoginBtn?.classList.remove("hidden");

    headerLoginBtn.textContent = "Log In";

    headerLoginBtn.setAttribute("href", "#account");

    headerSignupBtn?.classList.remove("hidden");

    headerSignupBtn.setAttribute("href", "#account");

  }

}

// ============================================================
// HOME / APP SCREEN VISIBILITY
// ============================================================

function showLoggedOutLanding() {

  document.body.classList.add("landing-active");

  // The public landing page is the first screen visitors see.
  homeSection?.classList.remove("hidden");

  // The account form opens only when the visitor chooses Log In
  // or Sign Up.
  accountSection?.classList.add("hidden");

}

function showLoggedInApp() {

  document.body.classList.remove("landing-active");

  // Hide the public landing page after login.
  homeSection?.classList.add("hidden");

  // Account is the authentication screen only.
  // It must NOT appear inside the Ride/Admin/Rider screens.
  // Logout is handled exclusively from the Profile screen.
  accountSection?.classList.add("hidden");

}

// ============================================================
// LANDING LOGIN / SIGNUP BUTTONS
// ============================================================

landingLoginBtn?.addEventListener("click", event => {

  event.preventDefault();

  accountSection?.classList.remove("hidden");
  showLoginMode();

  accountSection?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

});

landingSignupBtn?.addEventListener("click", event => {

  event.preventDefault();

  accountSection?.classList.remove("hidden");
  showSignupMode();

  accountSection?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

});

// Vehicle arrows select the requested service before opening Account.
document.querySelectorAll(".vehicle-book-btn").forEach(button => {

  button.addEventListener("click", event => {

    event.preventDefault();

    const service = button.dataset.service;

    if (rideType && service) {
      rideType.value = service;
    }

    accountSection?.classList.remove("hidden");
    showLoginMode();

    accountSection?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  });

});

// ============================================================
// PUBLIC LOGIN / SIGNUP BUTTONS
// ============================================================



headerSignupBtn?.addEventListener(
  "click",
  () => {

    showLoggedOutLanding();

    accountSection?.classList.remove("hidden");

    showSignupMode();

    accountSection?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  }
);

// ============================================================
// HIDE CUSTOMER FEATURES
// ============================================================

function hideCustomerFeatures() {

  bookNav?.classList.add("hidden");

  ridesNav?.classList.add("hidden");

  bookSection?.classList.add("hidden");

  ridesSection?.classList.add("hidden");

}

// ============================================================
// SHOW CUSTOMER FEATURES
// ============================================================

function showCustomerFeatures() {

  bookNav?.classList.remove("hidden");

  ridesNav?.classList.remove("hidden");

  // Ride is the booking/current-ride screen.
  // Rides History is opened separately by the bottom navigation.
  bookSection?.classList.remove("hidden");

  ridesSection?.classList.add("hidden");

}

// ============================================================
// HIDE DRIVER FEATURES
// ============================================================

function hideDriverFeatures() {

  driverNav?.classList.add("hidden");

  driverSection?.classList.add("hidden");

}

// ============================================================
// HIDE RIDER FEATURES
// ============================================================

function hideRiderFeatures() {

  riderNav?.classList.add("hidden");

  riderSection?.classList.add("hidden");

}

// ============================================================
// UPDATE HOME FOR ROLE
// ============================================================

function updateHomeForRole(role) {

  if (!homeBookBtn) {
    return;
  }

  if (
    role === "driver" ||
    role === "rider" ||
    role === "admin"
  ) {

    homeBookBtn.classList.add("hidden");

    if (homeRideMessage) {

      if (role === "driver") {

        homeRideMessage.textContent =
          "Manage your assigned Auto/Car rides from the Driver Dashboard.";

      } else if (role === "rider") {

        homeRideMessage.textContent =
          "Manage your assigned Bike rides from the Rider Dashboard.";

      } else {

        homeRideMessage.textContent =
          "Manage Let's Go bookings from the Admin Dashboard.";

      }

    }

    return;
  }

  if (role === "customer") {

    homeBookBtn.classList.remove("hidden");

    homeBookBtn.href = "#book";

    homeBookBtn.textContent =
      "Book a Ride";

    if (homeRideMessage) {

      homeRideMessage.textContent =
        "Book your ride in a few simple steps.";

    }

    return;

  }

  homeBookBtn.classList.remove("hidden");

  homeBookBtn.href = "#account";

  homeBookBtn.textContent =
    "Log in to Book";

  if (homeRideMessage) {

    homeRideMessage.textContent =
      "Log in and book your ride in a few steps.";

  }

}

// ============================================================
// VEHICLE TYPE NORMALIZATION
// ============================================================

function normalizeVehicleType(vehicleType) {

  if (
    vehicleType === null ||
    vehicleType === undefined
  ) {

    return "";

  }

  const value =
    String(vehicleType)
      .trim()
      .toLowerCase();

  if (
    value === "auto" ||
    value === "auto rickshaw" ||
    value === "autorickshaw" ||
    value === "auto-rickshaw" ||
    value === "rickshaw"
  ) {

    return "auto";

  }

  if (
    value === "bike" ||
    value === "bicycle" ||
    value === "motorbike" ||
    value === "motorcycle"
  ) {

    return "bike";

  }

  if (
    value === "car" ||
    value === "cab"
  ) {

    return "car";

  }

  return value;

}

// ============================================================
// VEHICLE DISPLAY NAME
// ============================================================

function vehicleDisplayName(vehicleType) {

  const normalized =
    normalizeVehicleType(vehicleType);

  if (normalized === "auto") {
    return "Auto";
  }

  if (normalized === "bike") {
    return "Bike";
  }

  if (normalized === "car") {
    return "Car";
  }

  return vehicleType || "Not specified";

}

// ============================================================
// REQUIRED ROLE FOR VEHICLE
// ============================================================

function requiredRoleForVehicle(vehicleType) {

  const normalized =
    normalizeVehicleType(vehicleType);

  if (normalized === "auto") {
    return "driver";
  }

  if (normalized === "bike") {
    return "rider";
  }

  if (normalized === "car") {
    return "driver";
  }

  return "";

}

// ============================================================
// UPDATE ONLINE/OFFLINE UI
// ============================================================

function updateOnlineStatusUI(
  role,
  isOnline
) {

  if (role === "driver") {

    if (driverOnlineStatus) {

      driverOnlineStatus.textContent =
        isOnline
          ? "Driver Status: You are ONLINE and can receive new rides."
          : "Driver Status: You are OFFLINE and cannot receive new rides.";

    }

    if (driverOnlineBtn) {

      driverOnlineBtn.textContent =
        isOnline
          ? "Go Offline"
          : "Go Online";

    }

  }

  if (role === "rider") {

    if (riderOnlineStatus) {

      riderOnlineStatus.textContent =
        isOnline
          ? "Rider Status: You are ONLINE and can receive new rides."
          : "Rider Status: You are OFFLINE and cannot receive new rides.";

    }

    if (riderOnlineBtn) {

      riderOnlineBtn.textContent =
        isOnline
          ? "Go Offline"
          : "Go Online";

    }

  }

}

// ============================================================
// CHECK WHETHER DRIVER/RIDER IS AVAILABLE
// ============================================================

async function isDriverAvailable(personId) {

  const {
    data: activeRides,
    error
  } = await supabase
    .from("bookings")
    .select("id")
    .eq(
      "driver_id",
      personId
    )
    .in(
      "status",
      [
        "pending",
        "accepted",
        "in_progress"
      ]
    )
    .limit(1);

  if (error) {

    console.error(
      "Availability check failed:",
      error
    );

    return false;

  }

  return !activeRides ||
    activeRides.length === 0;

}

// ============================================================
// AUTOMATIC DRIVER / RIDER ASSIGNMENT
// ============================================================

async function autoAssignDriver(bookingId) {

  if (!bookingId) {
    return null;
  }

  console.log(
    "Starting secure automatic assignment:",
    bookingId
  );

  const {
    data: assignedDriverId,
    error
  } = await supabase.rpc(
    "assign_booking_driver",
    {
      p_booking_id: bookingId
    }
  );

  if (error) {
    console.error(
      "Secure automatic assignment failed:",
      error
    );
    return null;
  }

  if (!assignedDriverId) {
    console.log(
      "No available matching online driver/rider found."
    );
    return null;
  }

  console.log(
    "Booking assigned by secure database function:",
    assignedDriverId
  );

  return assignedDriverId;
}

// ============================================================
// ASSIGN EXISTING PENDING RIDES WHEN PERSON GOES ONLINE
// ============================================================

async function assignPendingBookingsForOnlinePerson(
  personId
) {

  if (!personId) {
    return;
  }

  console.log(
    "Securely checking pending bookings for online person:",
    personId
  );

  const {
    data: assignedBookingId,
    error
  } = await supabase.rpc(
    "assign_pending_booking_for_person",
    {
      p_person_id: personId
    }
  );

  if (error) {
    console.error(
      "Could not securely assign pending booking:",
      error
    );
    return;
  }

  if (assignedBookingId) {
    console.log(
      "Pending booking assigned after person went online:",
      assignedBookingId
    );
  } else {
    console.log(
      "No pending matching booking available for this person."
    );
  }
}

// ============================================================
// SET DRIVER / RIDER ONLINE STATUS
// ============================================================

async function setOnlineStatus(
  isOnline,
  {
    refreshDashboard = true
  } = {}
) {

  // Use the already-known authenticated user whenever possible.
  // This avoids another auth request during login/logout.
  let user =
    currentAuthUser;

  if (!user) {

    const {
      data: { user: authUser }
    } = await supabase.auth.getUser();

    user = authUser;

  }

  if (!user) {
    return;
  }

  const {
    data: profile,
    error: profileError
  } = await supabase
    .from("profiles")
    .select(
      "role, vehicle_type"
    )
    .eq(
      "id",
      user.id
    )
    .maybeSingle();

  if (profileError) {

    console.error(
      "Could not check profile for online status:",
      profileError
    );

    return;

  }

  if (
    !profile ||
    (
      profile.role !== "driver" &&
      profile.role !== "rider"
    )
  ) {

    return;

  }

  const {
    error
  } = await supabase
    .from("profiles")
    .update({
      is_online: isOnline
    })
    .eq(
      "id",
      user.id
    );

  if (error) {

    console.error(
      "Could not update online status:",
      error
    );

    return;

  }

  updateOnlineStatusUI(
    profile.role,
    isOnline
  );

  console.log(
    isOnline
      ? "Driver/Rider is now ONLINE."
      : "Driver/Rider is now OFFLINE."
  );

  if (isOnline) {

    await assignPendingBookingsForOnlinePerson(
      user.id
    );

    if (!refreshDashboard) {
      return;
    }

    if (profile.role === "driver") {

      await loadDriverRides();

    }

    if (profile.role === "rider") {

      await loadRiderRides();

    }

  }

}

// ============================================================
// ONLINE / OFFLINE BUTTONS
// ============================================================

driverOnlineBtn?.addEventListener(
  "click",
  async () => {

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    const {
      data: profile,
      error
    } = await supabase
      .from("profiles")
      .select(
        "role, is_online"
      )
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

    if (
      error ||
      !profile
    ) {

      console.error(
        "Could not read driver online status:",
        error
      );

      return;

    }

    if (
      profile.role !== "driver"
    ) {

      return;

    }

    const newStatus =
      profile.is_online !== true;

    if (driverOnlineStatus) {

      driverOnlineStatus.textContent =
        newStatus
          ? "Going online..."
          : "Going offline...";

    }

    await setOnlineStatus(
      newStatus
    );

    await loadDriverRides();

  }
);

riderOnlineBtn?.addEventListener(
  "click",
  async () => {

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    const {
      data: profile,
      error
    } = await supabase
      .from("profiles")
      .select(
        "role, is_online"
      )
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

    if (
      error ||
      !profile
    ) {

      console.error(
        "Could not read rider online status:",
        error
      );

      return;

    }

    if (
      profile.role !== "rider"
    ) {

      return;

    }

    const newStatus =
      profile.is_online !== true;

    if (riderOnlineStatus) {

      riderOnlineStatus.textContent =
        newStatus
          ? "Going online..."
          : "Going offline...";

    }

    await setOnlineStatus(
      newStatus
    );

    await loadRiderRides();

  }
);

// ============================================================
// CHECK USER ROLE
// ============================================================

async function checkUserRole() {

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (
    userError ||
    !user
  ) {

    hideCustomerFeatures();

    adminNav?.classList.add("hidden");
    adminSection?.classList.add("hidden");

    hideDriverFeatures();
    hideRiderFeatures();

    updateHomeForRole(null);

    return null;

  }

  const {
    data: profile,
    error
  } = await supabase
    .from("profiles")
    .select(
      "role, vehicle_type, is_online"
    )
    .eq(
      "id",
      user.id
    )
    .maybeSingle();

  if (error) {

    console.error(
      "Profile check failed:",
      error
    );

    hideCustomerFeatures();

    adminNav?.classList.add("hidden");
    adminSection?.classList.add("hidden");

    hideDriverFeatures();
    hideRiderFeatures();

    updateHomeForRole(null);

    return null;

  }

  const role =
    profile?.role || "customer";

  currentAppRole = role;

  // ==========================================================
  // CUSTOMER
  // ==========================================================

  if (role === "customer") {

    showCustomerFeatures();

    adminNav?.classList.add("hidden");
    adminSection?.classList.add("hidden");

    hideDriverFeatures();
    hideRiderFeatures();

    updateHomeForRole("customer");

    return role;

  }

  // ==========================================================
  // ADMIN
  // ==========================================================

  if (role === "admin") {

    hideCustomerFeatures();

    adminNav?.classList.remove("hidden");
    adminSection?.classList.remove("hidden");

    hideDriverFeatures();
    hideRiderFeatures();

    updateHomeForRole("admin");

    await loadAdminBookings();

    return role;

  }

  // ==========================================================
  // DRIVER
  // ==========================================================

  if (role === "driver") {

    hideCustomerFeatures();

    adminNav?.classList.add("hidden");
    adminSection?.classList.add("hidden");

    driverNav?.classList.remove("hidden");
    driverSection?.classList.remove("hidden");

    hideRiderFeatures();

    updateHomeForRole("driver");

    updateOnlineStatusUI(
      "driver",
      profile?.is_online === true
    );

    await loadDriverRides();

    return role;

  }

  // ==========================================================
  // BIKE RIDER
  // ==========================================================

  if (role === "rider") {

    hideCustomerFeatures();

    adminNav?.classList.add("hidden");
    adminSection?.classList.add("hidden");

    hideDriverFeatures();

    riderNav?.classList.remove("hidden");
    riderSection?.classList.remove("hidden");

    updateHomeForRole("rider");

    updateOnlineStatusUI(
      "rider",
      profile?.is_online === true
    );

    await loadRiderRides();

    return role;

  }

  // ==========================================================
  // UNKNOWN ROLE
  // ==========================================================

  hideCustomerFeatures();

  adminNav?.classList.add("hidden");
  adminSection?.classList.add("hidden");

  hideDriverFeatures();
  hideRiderFeatures();

  updateHomeForRole(null);

  return role;

}

// ============================================================
// UPDATE AUTH UI
// ============================================================

async function updateAuthUI(authUser = undefined) {

  // Prevent several auth events from rebuilding the application
  // at the same time.
  if (authUIUpdatePromise) {
    return authUIUpdatePromise;
  }

  authUIUpdatePromise = (async () => {

    let user = authUser;

    if (authUser === undefined) {

      const {
        data: { user: currentUser }
      } = await supabase.auth.getUser();

      user = currentUser || null;

    }

    currentAuthUser = user || null;

    updateHeaderAuthUI(!!user);

    if (user) {

      showLoggedInApp();

      authBox?.classList.add("hidden");

      loggedInBox?.classList.remove("hidden");

      if (profileLogoutBtn) {

  profileLogoutBtn.classList.remove("hidden");
  profileLogoutBtn.disabled = false;
  profileLogoutBtn.textContent = "Log Out";

}

      if (userEmail) {

        userEmail.textContent =
          user.email ||
          user.phone ||
          "";

      }

      if (authMessage) {

        authMessage.textContent =
          "You are logged in.";

      }

      const role =
        await checkUserRole();

      // checkUserRole() loads the correct role dashboard.
      // Do not load the same dashboard again here.

      if (role === "customer") {
        await loadUpcomingCustomerRides();
        await initializeLetsGoMap();
      }

    } else {

      currentAuthUser = null;
      currentAppRole = null;

      showLoggedOutLanding();

      authBox?.classList.add("hidden");

      loggedInBox?.classList.add("hidden");

      if (authMessage) {

        authMessage.textContent =
          "Please log in or create an account.";

      }

      showLoginMode();

      if (list) {

        list.innerHTML = `
          <div class="card">
            Please log in to see your rides.
          </div>
        `;

      }

      hideCustomerFeatures();

      adminNav?.classList.add("hidden");
      adminSection?.classList.add("hidden");

      hideDriverFeatures();
      hideRiderFeatures();

      updateHomeForRole(null);

    }

  })();

  try {

    return await authUIUpdatePromise;

  } finally {

    authUIUpdatePromise = null;

  }

}

// ============================================================
// SHOW SIGNUP
// ============================================================

showSignupBtn?.addEventListener(
  "click",
  () => {

    showSignupMode();

  }
);

// ============================================================
// SHOW LOGIN
// ============================================================

showLoginBtn?.addEventListener(
  "click",
  () => {

    showLoginMode();

  }
);
// ============================================================
// GOOGLE SIGN IN
// ============================================================

async function signInWithGoogle() {

  if (authStatus) {

    authStatus.textContent =
      "Connecting to Google...";

  }

  googleAuthBtns.forEach(
    button => {
      button.disabled = true;
    }
  );

  const {
    error
  } = await supabase.auth.signInWithOAuth({

    provider: "google",

    options: {

      redirectTo:
  window.location.origin + window.location.pathname

    }

  });

  if (error) {

    console.error(
      "Google sign-in error:",
      error
    );

    if (authStatus) {

      authStatus.textContent =
        "Google sign-in failed: " +
        error.message;

    }

    googleAuthBtns.forEach(
      button => {
        button.disabled = false;
      }
    );

  }

}

googleAuthBtns.forEach(
  button => {

    button.addEventListener(
      "click",
      async event => {

        event.preventDefault();

        await signInWithGoogle();

      }
    );

  }
);

// ============================================================
// SIGN UP
// ============================================================

signupBtn?.addEventListener(
  "click",
  async () => {

    const fullNameValue =
      fullName?.value.trim();

    const accountPhoneValue =
      accountPhone?.value.trim();

    const emailValue =
      signupEmail?.value.trim();

    const passwordValue =
      signupPassword?.value;

    if (
      !fullNameValue ||
      !accountPhoneValue ||
      !emailValue ||
      !passwordValue
    ) {

      if (authStatus) {

        authStatus.textContent =
          "Enter your full name, phone, email and password.";

      }

      return;

    }

    if (authStatus) {

      authStatus.textContent =
        "Creating account...";

    }

    const {
      data,
      error
    } = await supabase.auth.signUp({

      email: emailValue,

      password: passwordValue,

      options: {

        data: {
          full_name: fullNameValue,
          phone: accountPhoneValue
        }

      }

    });

    if (error) {

      console.error(
        "Signup error:",
        error
      );

      if (authStatus) {

        authStatus.textContent =
          error.message;

      }

      return;

    }

    if (data?.user) {

      const {
        error: profileError
      } = await supabase
        .from("profiles")
        .upsert({

          id: data.user.id,

          full_name: fullNameValue,

          phone: accountPhoneValue,

          role: "customer",

          is_online: false

        });

      if (profileError) {

        console.error(
          "Profile creation error:",
          profileError
        );

      }

    }

    if (data?.session) {

      if (authStatus) {

        authStatus.textContent =
          "Account created successfully.";

      }

      await updateAuthUI(data.user);

    } else {

      if (authStatus) {

        authStatus.textContent =
          "Account created. Check your email if confirmation is required.";

      }

    }

    if (fullName)
      fullName.value = "";

    if (accountPhone)
      accountPhone.value = "";

    if (signupEmail)
      signupEmail.value = "";

    if (signupPassword)
      signupPassword.value = "";

  }
);

// ============================================================
// LOGIN
// ============================================================

loginBtn?.addEventListener(
  "click",
  async () => {

    const loginValue =
      loginMode?.querySelector("#email")?.value.trim() ||
      email?.value.trim();

    const passwordValue =
      password?.value;

    if (
      !loginValue ||
      !passwordValue
    ) {

      if (authStatus) {

        authStatus.textContent =
          "Enter your email or phone number and password.";

      }

      return;

    }

    if (authStatus) {

      authStatus.textContent =
        "Logging in...";

    }

    let result;

    if (
      loginValue.includes("@")
    ) {

      result =
        await supabase.auth.signInWithPassword({

          email: loginValue,

          password: passwordValue

        });

    } else {

      result =
        await supabase.auth.signInWithPassword({

          phone: loginValue,

          password: passwordValue

        });

    }

    if (result.error) {

      console.error(
        "Login error:",
        result.error
      );

      if (authStatus) {

        authStatus.textContent =
          result.error.message;

      }

      return;

    }

    if (authStatus) {

      authStatus.textContent =
        "Login successful.";

    }

    // SIGNED_IN below updates the application immediately.
    // Online status for drivers/riders is handled in the background.

  }
);

// ==========================================================
// SHOW / HIDE PASSWORD
// ==========================================================

togglePasswordBtn?.addEventListener(
  "click",
  () => {

    if (!password) {
      return;
    }

    if (password.type === "password") {

      password.type = "text";

      togglePasswordBtn.textContent = "🙈";

      togglePasswordBtn.setAttribute(
        "aria-label",
        "Hide password"
      );

    } else {

      password.type = "password";

      togglePasswordBtn.textContent = "👁";

      togglePasswordBtn.setAttribute(
        "aria-label",
        "Show password"
      );

    }

  }
);

// ==========================================================
// FORGOT PASSWORD
// ==========================================================

forgotPasswordBtn?.addEventListener(
  "click",
  async () => {

    const emailValue =
      email?.value.trim();

    if (!emailValue) {

      if (authStatus) {

        authStatus.textContent =
          "Enter your email address first.";

      }

      return;

    }

    if (!emailValue.includes("@")) {

      if (authStatus) {

        authStatus.textContent =
          "Password reset requires your email address.";

      }

      return;

    }

    if (authStatus) {

      authStatus.textContent =
        "Sending password reset email...";

    }

    const {
      error
    } = await supabase.auth.resetPasswordForEmail(
      emailValue,
      {
        redirectTo:
          window.location.origin
      }
    );

    if (error) {

      console.error(
        "Password reset error:",
        error
      );

      if (authStatus) {

        authStatus.textContent =
          "Password reset failed: " +
          error.message;

      }

      return;

    }

    if (authStatus) {

      authStatus.textContent =
        "Password reset email sent. Check your email.";

    }

  }
);

// ============================================================
// LOGOUT
// ============================================================

// Logout belongs ONLY to the Profile screen.
// Do not create, move, or append another logout button from JavaScript.
// The HTML already contains the single Profile logout button.

async function performLogout() {

  const button =
    profileLogoutBtn;

  if (button) {
    button.disabled = true;
    button.textContent = "Logging Out...";
  }

  // Sign out immediately. Driver/rider offline status is background work.
  const user = currentAuthUser;
  const role = currentAppRole;

  if (
    user &&
    (role === "driver" || role === "rider")
  ) {

    supabase
      .from("profiles")
      .update({ is_online: false })
      .eq("id", user.id)
      .then(({ error }) => {
        if (error) {
          console.error(
            "Background offline update failed:",
            error
          );
        }
      });

  }

  const { error } = await supabase.auth.signOut();

  if (error) {

    console.error("Logout error:", error);

    if (authStatus) {
      authStatus.textContent =
        "Logout failed: " + error.message;
    }

    if (button) {
      button.disabled = false;
      button.textContent = "Log Out";
    }

    return false;

  }

  // Clear authenticated application state immediately.
  currentAuthUser = null;
  currentAppRole = null;

  // Render the logged-out screen immediately; do not require a refresh.
  showLoggedOutLanding();
  authBox?.classList.remove("hidden");
  loggedInBox?.classList.add("hidden");
  profileLogoutBtn?.classList.add("hidden");

  updateHeaderAuthUI(false);

  hideCustomerFeatures();
  adminNav?.classList.add("hidden");
  adminSection?.classList.add("hidden");
  hideDriverFeatures();
  hideRiderFeatures();

  hideAllMobileSections();
  homeSection?.classList.remove("hidden");

  document.body.classList.remove(
    "lg-mobile-mode",
    "lg-ride-active",
    "lg-services-active",
    "lg-profile-active"
  );

  document
    .getElementById("lgBottomNav")
    ?.classList.remove("visible");

  setMobileNavActive(null);

  if (email) email.value = "";
  if (password) password.value = "";
  if (signupEmail) signupEmail.value = "";
  if (signupPassword) signupPassword.value = "";

  showLoginMode();

  if (authStatus) {
    authStatus.textContent =
      "You have been logged out.";
  }

  return true;

}

// Public bridge for Profile and other app-owned logout controls.
window.letsGoLogout = performLogout;

// Profile screen logout button.
profileLogoutBtn?.addEventListener(
  "click",
  async event => {

    event.preventDefault();

    await performLogout();

  }
);

// Header Log In button is ONLY a logged-out navigation action.
// Logged-in users must use Log Out from the Profile screen.
headerLoginBtn?.addEventListener(
  "click",
  event => {

    event.preventDefault();

    showLoggedOutLanding();

    accountSection?.classList.remove(
      "hidden"
    );

    showLoginMode();

    accountSection?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  }
);

// ============================================================
// LOAD ASSIGNABLE PEOPLE
// ============================================================

async function loadAssignablePeople() {

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, vehicle_type, role, is_online"
    )
    .in(
      "role",
      [
        "driver",
        "rider"
      ]
    )
    .order(
      "full_name"
    );

  if (error) {

    console.error(
      "Assignable people loading error:",
      error
    );

    return [];

  }

  return data || [];

}

// ============================================================
// LOAD DRIVERS
// ============================================================

async function loadDrivers() {

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, vehicle_type, role, is_online"
    )
    .eq(
      "role",
      "driver"
    )
    .order(
      "full_name"
    );

  if (error) {

    console.error(
      "Driver loading error:",
      error
    );

    return [];

  }

  return data || [];

}

// ============================================================
// LOAD BIKE RIDERS
// ============================================================

async function loadBikeRiders() {

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, vehicle_type, role, is_online"
    )
    .eq(
      "role",
      "rider"
    )
    .eq(
      "vehicle_type",
      "bike"
    )
    .order(
      "full_name"
    );

  if (error) {

    console.error(
      "Bike rider loading error:",
      error
    );

    return [];

  }

  return data || [];

}

// ============================================================
// BOOK RIDE
// ============================================================

bookBtn?.addEventListener(
  "click",
  async () => {

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {

      if (status) {

        status.textContent =
          "Please log in before booking a ride.";

      }

      return;

    }

    const {
      data: profile,
      error: profileError
    } = await supabase
      .from("profiles")
      .select("role")
      .eq(
        "id",
        user.id
      )
      .maybeSingle();

    if (profileError) {

      console.error(
        "Role check error:",
        profileError
      );

      if (status) {

        status.textContent =
          "Could not verify your account role.";

      }

      return;

    }

    const role =
      profile?.role || "customer";

    if (
      role !== "customer"
    ) {

      if (status) {

        status.textContent =
          "Only customer accounts can book rides.";

      }

      return;

    }

    const pickupValue =
      pickup?.value.trim();

    const destinationValue =
      destination?.value.trim();

    const serviceValue =
      normalizeVehicleType(
        rideType?.value
      );
    if (
      !pickupValue ||
      !destinationValue
    ) {

      if (status) {

        status.textContent =
          "Please fill in pickup and destination.";

      }

      return;

    }

    if (
      ![
        "auto",
        "bike",
        "car"
      ].includes(
        serviceValue
      )
    ) {

      if (status) {

        status.textContent =
          "Please select Auto, Bike or Car.";

      }

      return;

    }

    if (status) {

      status.textContent =
        "Booking...";

    }

    const {
      data: booking,
      error
    } = await supabase
      .from("bookings")
      .insert({

        user_id: user.id,

        service: serviceValue,

        pickup_location: pickupValue,

        destination: destinationValue,

        status: "pending",

        driver_id: null,

        rejected_driver_ids: []

      })
      .select()
      .single();

    if (error) {

      console.error(
        "Booking error:",
        error
      );

      if (status) {

        status.textContent =
          "Booking failed: " +
          error.message;

      }

      return;

    }

    if (status) {

      status.textContent =
        "Booking created. Finding a matching online driver/rider...";

    }

    if (pickup)
      pickup.value = "";

    if (destination)
      destination.value = "";

    

    if (phone)
      phone.value = "";

    if (pickupMarker) {
      pickupMarker.setMap(null);
      pickupMarker = null;
    }

    if (destinationMarker) {
      destinationMarker.setMap(null);
      destinationMarker = null;
    }

    if (booking?.id) {

      const assignedPerson =
        await autoAssignDriver(
          booking.id
        );

      if (assignedPerson) {

        if (status) {

          status.textContent =
            `Ride booked successfully! A matching ${vehicleDisplayName(serviceValue)} ${requiredRoleForVehicle(serviceValue)} has been assigned.`;

        }

      } else {

        if (status) {

          status.textContent =
            `Ride booked successfully! We are looking for an available matching ${vehicleDisplayName(serviceValue)} ${requiredRoleForVehicle(serviceValue)}.`;

        }

      }

    }

    await loadUpcomingCustomerRides();

    await loadRides();

  }
);

// ============================================================
// CUSTOMER STATUS MESSAGE
// ============================================================

function getCustomerStatusMessage(booking) {

  if (
    booking.status === "pending" &&
    booking.driver_id
  ) {

    return "Your ride is waiting for the assigned driver/rider to respond.";

  }

  if (
    booking.status === "pending" &&
    !booking.driver_id
  ) {

    return "We're looking for an available matching driver/rider.";

  }

  if (
    booking.status === "accepted"
  ) {

    return "Your driver/rider has accepted the ride.";

  }

  if (
    booking.status === "in_progress"
  ) {

    return "Your ride is currently in progress.";

  }

  if (
    booking.status === "completed"
  ) {

    return "Your ride has been completed.";

  }

  if (
    booking.status === "cancelled"
  ) {

    return "Your ride has been cancelled.";

  }

  return "";

}

// ============================================================
// CANCEL CUSTOMER RIDE
// ============================================================

async function cancelBooking(bookingId) {

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const confirmed =
    confirm(
      "Are you sure you want to cancel this ride?"
    );

  if (!confirmed) {
    return;
  }

  const {
    error
  } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      driver_id: null
    })
    .eq(
      "id",
      bookingId
    )
    .eq(
      "user_id",
      user.id
    )
    .eq(
      "status",
      "pending"
    );

  if (error) {

    console.error(
      "Cancel booking error:",
      error
    );

    alert(
      "Could not cancel the ride: " +
      error.message
    );

    return;

  }

  await loadUpcomingCustomerRides();

  await loadRides();

}

// ============================================================
// LOAD USER RIDE HISTORY
// ============================================================

function customerRideCardHTML(
  booking,
  includeCancel = false
) {

  const cancelButton =
    includeCancel &&
    booking.status === "pending"
      ? `
        <button
          class="cancel-ride-btn btn"
          data-booking-id="${booking.id}"
        >
          Cancel Ride
        </button>
      `
      : "";

  const customerMessage =
    getCustomerStatusMessage(
      booking
    );

  return `
    <div class="card">

      <strong>
        ${booking.pickup_location}
      </strong>

      →

      <strong>
        ${booking.destination}
      </strong>

      <p>
        <strong>Status:</strong>
        ${booking.status || "pending"}
      </p>

      ${
        customerMessage
          ? `
            <p>
              <strong>
                ${customerMessage}
              </strong>
            </p>
          `
          : ""
      }

      <p>
        Service:
        ${vehicleDisplayName(
          booking.service
        )}
      </p>

      ${cancelButton}

    </div>
  `;

}

function bindCustomerCancelButtons() {

  document
    .querySelectorAll(
      ".cancel-ride-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            await cancelBooking(
              bookingId
            );

          }
        );

      }
    );

}

// ============================================================
// LOAD CURRENT / UPCOMING CUSTOMER RIDES
// ============================================================

async function loadUpcomingCustomerRides() {

  const user =
    currentAuthUser;

  if (!user || !bookSection) {
    return;
  }

  // Clear any old booking message whenever the Ride screen is loaded.
  // The booking status message must reflect the current active booking,
  // not a ride that was completed or cancelled earlier.
  if (status) {
    status.textContent = "";
  }

  let upcomingContainer =
    document.getElementById(
      "upcomingRides"
    );

  if (!upcomingContainer) {

    upcomingContainer =
      document.createElement("div");

    upcomingContainer.id =
      "upcomingRides";

    bookSection.appendChild(
      upcomingContainer
    );

  }

  upcomingContainer.innerHTML = `
    <div class="heading">
      <h2>Upcoming Ride</h2>
      <p>Your current and upcoming booking.</p>
    </div>

    <div class="card">
      Loading...
    </div>
  `;

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .select("*")
    .eq(
      "user_id",
      user.id
    )
    .in(
      "status",
      ACTIVE_RIDE_STATUSES
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Load upcoming rides error:",
      error
    );

    upcomingContainer.innerHTML = `
      <div class="card">
        Could not load your current ride.
      </div>
    `;

    return;

  }

  if (
    !data ||
    data.length === 0
  ) {

    upcomingContainer.innerHTML = `
      <div class="card">
        No upcoming rides.
      </div>
    `;

    // No active ride means there must be no booking-progress message.
    if (status) {
      status.textContent = "";
    }

    return;

  }

  upcomingContainer.innerHTML =
    data.map(
      booking =>
        customerRideCardHTML(
          booking,
          true
        )
    ).join("");

  // If an active ride exists, show its current status rather than a
  // stale message left by a previous booking.
  if (status) {
    status.textContent =
      getCustomerStatusMessage(data[0]);
  }

  bindCustomerCancelButtons();

}

// ============================================================
// LOAD RIDE HISTORY
// ============================================================

async function loadRides() {

  // Use the user already established by the authenticated app
  // state. This prevents the History tab from briefly behaving
  // as if the user is logged out.
  const user =
    currentAuthUser;

  if (!user || !list) {
    if (list && !user) {
      list.innerHTML = `
        <div class="card">
          Please log in to see your rides.
        </div>
      `;
    }

    return;
  }

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .select("*")
    .eq(
      "user_id",
      user.id
    )
    .in(
      "status",
      [
        "completed",
        "cancelled"
      ]
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Load ride history error:",
      error
    );

    list.innerHTML = `
      <div class="card">
        Could not load your ride history.
      </div>
    `;

    return;

  }

  if (
    !data ||
    data.length === 0
  ) {

    list.innerHTML = `
      <div class="card">
        No previous rides yet.
      </div>
    `;

    return;

  }

  list.innerHTML =
    data.map(
      booking =>
        customerRideCardHTML(
          booking,
          false
        )
    ).join("");

}

// ============================================================
// ASSIGN DRIVER / RIDER — ADMIN
// ============================================================

async function assignDriver(
  bookingId,
  personId
) {

  if (!personId) {

    if (adminStatus) {

      adminStatus.textContent =
        "Please select a matching driver/rider first.";

    }

    return;

  }

  if (adminStatus) {

    adminStatus.textContent =
      "Checking assignment...";

  }

  const {
    data: booking,
    error: bookingError
  } = await supabase
    .from("bookings")
    .select(
      "id, service, status, driver_id"
    )
    .eq(
      "id",
      bookingId
    )
    .maybeSingle();

  if (
    bookingError ||
    !booking
  ) {

    console.error(
      "Booking check error:",
      bookingError
    );

    if (adminStatus) {

      adminStatus.textContent =
        "Could not verify the booking.";

    }

    return;

  }

  const {
    data: person,
    error: personError
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, vehicle_type, role, is_online"
    )
    .eq(
      "id",
      personId
    )
    .maybeSingle();

  if (
    personError ||
    !person
  ) {

    console.error(
      "Assignment person check error:",
      personError
    );

    if (adminStatus) {

      adminStatus.textContent =
        "Could not verify the selected driver/rider.";

    }

    return;

  }

  const requiredVehicle =
    normalizeVehicleType(
      booking.service
    );

  const requiredRole =
    requiredRoleForVehicle(
      requiredVehicle
    );

  const personVehicle =
    normalizeVehicleType(
      person.vehicle_type
    );

  if (
    person.role !== requiredRole
  ) {

    if (adminStatus) {

      adminStatus.textContent =
        `Cannot assign this person. ${vehicleDisplayName(requiredVehicle)} bookings require a ${requiredRole} account.`;

    }

    return;

  }

  if (
    personVehicle !==
    requiredVehicle
  ) {

    if (adminStatus) {

      adminStatus.textContent =
        `Cannot assign this person. Booking requires ${vehicleDisplayName(requiredVehicle)}, but this account is registered for ${vehicleDisplayName(personVehicle)}.`;

    }

    return;

  }

  const available =
    await isDriverAvailable(
      personId
    );

  if (!available) {

    if (adminStatus) {

      adminStatus.textContent =
        "This driver/rider already has an active ride.";

    }

    return;

  }

  if (adminStatus) {

    adminStatus.textContent =
      "Assigning...";

  }

  const {
    error
  } = await supabase
    .from("bookings")
    .update({
      driver_id: personId
    })
    .eq(
      "id",
      bookingId
    );

  if (error) {

    console.error(
      "Assignment error:",
      error
    );

    if (adminStatus) {

      adminStatus.textContent =
        "Assignment failed: " +
        error.message;

    }

    return;

  }

  await loadAdminBookings();

  const bookingCard =
    document.querySelector(
      `.admin-booking-card[data-booking-id="${bookingId}"]`
    );

  const assignmentMessage =
    bookingCard?.querySelector(
      ".assignment-message"
    );

  if (assignmentMessage) {

    assignmentMessage.textContent =
      `Matching ${vehicleDisplayName(requiredVehicle)} ${requiredRole} assigned successfully.`;

    assignmentMessage.classList.remove(
      "hidden"
    );

  }

}

// ============================================================
// LOAD ALL BOOKINGS FOR ADMIN
// ============================================================

async function loadAdminBookings() {

  if (!adminList) {
    return;
  }

  if (adminStatus) {

    adminStatus.textContent =
      "Loading bookings...";

  }

  const people =
    await loadAssignablePeople();

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .select("*")
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Admin bookings error:",
      error
    );

    if (adminStatus) {

      adminStatus.textContent =
        "Could not load admin bookings.";

    }

    adminList.innerHTML = `
      <div class="card">
        ${error.message}
      </div>
    `;

    return;

  }

  if (adminStatus) {

    adminStatus.textContent =
      `${data.length} booking(s) found.`;

  }

  const customerProfiles =
    await loadCustomerProfiles(data);

  if (
    !data ||
    data.length === 0
  ) {

    adminList.innerHTML = `
      <div class="card">
        No bookings found.
      </div>
    `;

    return;

  }

  adminList.innerHTML =
    data.map(
      booking => {

        const customerProfile =
          customerProfiles[booking.user_id] || {};

        const canAssignDriver =
          booking.status !== "completed" &&
          booking.status !== "cancelled";

        const requiredVehicle =
          normalizeVehicleType(
            booking.service
          );

        const requiredRole =
          requiredRoleForVehicle(
            requiredVehicle
          );

        const matchingPeople =
          people.filter(
            person =>
              person.role === requiredRole &&
              normalizeVehicleType(
                person.vehicle_type
              ) === requiredVehicle
          );

        const driverOptions =
          matchingPeople.map(
            person => {

              return `
                <option
                  value="${person.id}"
                  ${
                    booking.driver_id === person.id
                      ? "selected"
                      : ""
                  }
                >
                  ${person.full_name || "Driver/Rider"}
                  -
                  ${vehicleDisplayName(person.vehicle_type)}
                  ${
                    person.phone
                      ? " - " + person.phone
                      : ""
                  }
                  ${
                    person.is_online === true
                      ? " - Online"
                      : " - Offline"
                  }
                </option>
              `;

            }
          ).join("");

        const assignmentHTML =
          canAssignDriver
            ? `
              <p>
                <strong>
                  Required vehicle:
                </strong>
                ${vehicleDisplayName(requiredVehicle)}
              </p>

              <p>
                <strong>
                  Required account:
                </strong>
                ${requiredRole}
              </p>

              <p>
                <strong>
                  Matching:
                </strong>
                ${matchingPeople.length}
              </p>

              <label>
                Assign ${requiredRole === "rider" ? "Rider" : "Driver"}

                <select
                  class="driver-select"
                  data-booking-id="${booking.id}"
                >

                  <option value="">
                    Select a matching
                    ${vehicleDisplayName(requiredVehicle)}
                    ${requiredRole === "rider" ? "rider" : "driver"}
                  </option>

                  ${driverOptions}

                </select>

              </label>

              <br>

              <button
                class="assign-driver-btn btn"
                data-booking-id="${booking.id}"
              >
                Assign
                ${requiredRole === "rider" ? "Rider" : "Driver"}
              </button>
            `
            : "";

        const assignedPerson =
          people.find(
            person =>
              person.id === booking.driver_id
          );

        const assignedDriverHTML =
          assignedPerson
            ? `
              <p>

                <strong>
                  Assigned:
                </strong>

                ${
                  assignedPerson.full_name ||
                  "Driver/Rider"
                }

                <br>

                <strong>
                  Role:
                </strong>

                ${assignedPerson.role}

                <br>

                <strong>
                  Vehicle:
                </strong>

                ${vehicleDisplayName(
                  assignedPerson.vehicle_type
                )}

                <br>

                <strong>
                  Online:
                </strong>

                ${
                  assignedPerson.is_online === true
                    ? "Yes"
                    : "No"
                }

              </p>
            `
            : `
              <p>

                <strong>
                  Assigned:
                </strong>

                Not assigned

              </p>
            `;

        return `
          <div
            class="card admin-booking-card"
            data-booking-id="${booking.id}"
          >

            <h3>
              ${booking.pickup_location}
              →
              ${booking.destination}
            </h3>

            <p>
              <strong>
                Service:
              </strong>
              ${vehicleDisplayName(booking.service)}
            </p>

            <p>
              <strong>
                Date:
              </strong>
              ${booking.booking_date || "-"}
            </p>

            <p>
              <strong>
                Time:
              </strong>
              ${booking.booking_time || "-"}
            </p>

            <p>
              <strong>
                Customer Phone:
              </strong>
              ${customerProfile.phone || "-"}
            </p>

            <p>
              <strong>
                Status:
              </strong>
              ${booking.status || "pending"}
            </p>

            ${assignedDriverHTML}

            <p class="assignment-message hidden"></p>

            ${assignmentHTML}

            <br>

            <label>

              Change Status

              <select
                class="admin-status-select"
                data-booking-id="${booking.id}"
              >

                <option
                  value="pending"
                  ${
                    booking.status === "pending"
                      ? "selected"
                      : ""
                  }
                >
                  Pending
                </option>

                <option
                  value="accepted"
                  ${
                    booking.status === "accepted"
                      ? "selected"
                      : ""
                  }
                >
                  Accepted
                </option>

                <option
                  value="in_progress"
                  ${
                    booking.status === "in_progress"
                      ? "selected"
                      : ""
                  }
                >
                  In Progress
                </option>

                <option
                  value="completed"
                  ${
                    booking.status === "completed"
                      ? "selected"
                      : ""
                  }
                >
                  Completed
                </option>

                <option
                  value="cancelled"
                  ${
                    booking.status === "cancelled"
                      ? "selected"
                      : ""
                  }
                >
                  Cancelled
                </option>

              </select>

            </label>

          </div>
        `;

      }
    ).join("");

  document
    .querySelectorAll(
      ".assign-driver-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const select =
              document.querySelector(
                `.driver-select[data-booking-id="${bookingId}"]`
              );

            const personId =
              select
                ? select.value
                : "";

            await assignDriver(
              bookingId,
              personId
            );

          }
        );

      }
    );

  document
    .querySelectorAll(
      ".admin-status-select"
    )
    .forEach(
      select => {

        select.addEventListener(
          "change",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const newStatus =
              event.currentTarget.value;

            await updateBookingStatus(
              bookingId,
              newStatus
            );

          }
        );

      }
    );

}

// ============================================================
// UPDATE BOOKING STATUS — ADMIN
// ============================================================

async function updateBookingStatus(
  bookingId,
  newStatus
) {

  if (adminStatus) {

    adminStatus.textContent =
      "Updating booking...";

  }

  const {
    error
  } = await supabase
    .from("bookings")
    .update({
      status: newStatus
    })
    .eq(
      "id",
      bookingId
    );

  if (error) {

    console.error(error);

    if (adminStatus) {

      adminStatus.textContent =
        "Update failed: " +
        error.message;

    }

    return;

  }

  if (adminStatus) {

    adminStatus.textContent =
      "Booking status updated.";

  }

  await loadAdminBookings();

  await loadRides();

  await loadDriverRides();

  await loadRiderRides();

}

// ============================================================
// UPDATE DRIVER / RIDER RIDE STATUS
// ============================================================

async function updateDriverRideStatus(
  bookingId,
  newStatus
) {

  const driverStatus =
    document.getElementById(
      "driverStatus"
    );

  const riderStatus =
    document.getElementById(
      "riderStatus"
    );

  const statusElement =
    driverStatus ||
    riderStatus;

  if (statusElement) {

    statusElement.textContent =
      "Updating ride...";

  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {

    if (statusElement) {

      statusElement.textContent =
        "Please log in.";

    }

    return;

  }

  const {
    data: profile,
    error: profileError
  } = await supabase
    .from("profiles")
    .select(
      "role, vehicle_type, is_online"
    )
    .eq(
      "id",
      user.id
    )
    .maybeSingle();

  if (
    profileError ||
    !profile
  ) {

    if (statusElement) {

      statusElement.textContent =
        "Could not verify your account.";

    }

    return;

  }

  const {
    data: booking,
    error: bookingError
  } = await supabase
    .from("bookings")
    .select(
      "id, driver_id, status, service, rejected_driver_ids"
    )
    .eq(
      "id",
      bookingId
    )
    .maybeSingle();

  if (bookingError) {

    console.error(
      "Could not load booking:",
      bookingError
    );

    if (statusElement) {

      statusElement.textContent =
        "Could not load ride.";

    }

    return;

  }

  if (
    !booking ||
    booking.driver_id !== user.id
  ) {

    if (statusElement) {

      statusElement.textContent =
        "This ride is no longer assigned to you.";

    }

    return;

  }

  const requiredVehicle =
    normalizeVehicleType(
      booking.service
    );

  const requiredRole =
    requiredRoleForVehicle(
      requiredVehicle
    );

  if (
    profile.role !== requiredRole ||
    normalizeVehicleType(
      profile.vehicle_type
    ) !== requiredVehicle
  ) {

    if (statusElement) {

      statusElement.textContent =
        "Your account does not match this ride.";

    }

    return;

  }

  // ==========================================================
  // REJECTION
  // ==========================================================

  if (
    newStatus === "driver_rejected"
  ) {

    if (
      booking.status !== "pending"
    ) {

      if (statusElement) {
        statusElement.textContent =
          "Only a pending assigned ride can be rejected.";
      }

      return;
    }

    // Rejection is handled by a secure Supabase function.
    // This prevents browser-side RLS limitations from blocking the
    // required driver_id/rejected_driver_ids update.
    const {
      data: rejectionResult,
      error: rejectionError
    } = await supabase.rpc(
      "reject_booking_and_reassign",
      {
        p_booking_id: bookingId
      }
    );

    if (rejectionError) {

      console.error(
        "Secure rejection error:",
        rejectionError
      );

      if (statusElement) {

        statusElement.textContent =
          "Rejection failed: " +
          rejectionError.message;

      }

      return;

    }

    console.log(
      "Secure rejection result:",
      rejectionResult
    );

    if (statusElement) {

      statusElement.textContent =
        `Ride rejected. Looking for another matching ${vehicleDisplayName(requiredVehicle)}...`;

    }

    // Immediately search for another matching ONLINE person.
    const replacement =
      await autoAssignDriver(
        bookingId
      );

    if (replacement) {

      if (statusElement) {

        statusElement.textContent =
          `Ride rejected. Another matching ${vehicleDisplayName(requiredVehicle)} has been assigned.`;

      }

    } else {

      if (statusElement) {

        statusElement.textContent =
          `Ride rejected. Looking for another available matching ${vehicleDisplayName(requiredVehicle)}.`;

      }

    }

    await loadDriverRides();

    await loadRiderRides();

    await loadRides();

    return;

  }

  // ==========================================================
  // NORMAL STATUS TRANSITIONS
  // ==========================================================

  const allowedTransition =
    (
      booking.status === "pending" &&
      newStatus === "accepted"
    ) ||
    (
      booking.status === "accepted" &&
      newStatus === "in_progress"
    ) ||
    (
      booking.status === "in_progress" &&
      newStatus === "completed"
    );

  if (!allowedTransition) {

    if (statusElement) {

      statusElement.textContent =
        "That status change is not allowed.";

    }

    return;

  }

  const {
    error
  } = await supabase
    .from("bookings")
    .update({
      status: newStatus
    })
    .eq(
      "id",
      bookingId
    )
    .eq(
      "driver_id",
      user.id
    );

  if (error) {

    console.error(
      "Status update error:",
      error
    );

    if (statusElement) {

      statusElement.textContent =
        "Update failed: " +
        error.message;

    }

    return;

  }

  if (statusElement) {

    statusElement.textContent =
      "Ride status updated.";

  }

  await loadDriverRides();

  await loadRiderRides();

  await loadRides();

}

// ============================================================
// DRIVER ACTIONS
// ============================================================

function getDriverAction(booking) {

  if (
    booking.status === "pending"
  ) {

    return `

      <button
        class="driver-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="accepted"
      >
        Accept Ride
      </button>

      <button
        class="driver-reject-btn"
        data-booking-id="${booking.id}"
      >
        Reject Ride
      </button>

    `;

  }

  if (
    booking.status === "accepted"
  ) {

    return `

      <button
        class="driver-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="in_progress"
      >
        Start Ride
      </button>

    `;

  }

  if (
    booking.status === "in_progress"
  ) {

    return `

      <button
        class="driver-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="completed"
      >
        Complete Ride
      </button>

    `;

  }

  if (
    booking.status === "completed"
  ) {

    return `
      <p>
        <strong>
          Ride Completed
        </strong>
      </p>
    `;

  }

  if (
    booking.status === "cancelled"
  ) {

    return `
      <p>
        <strong>
          Ride Cancelled
        </strong>
      </p>
    `;

  }

  return "";

}

// ============================================================
// RIDER ACTIONS
// ============================================================

function getRiderAction(booking) {

  if (
    booking.status === "pending"
  ) {

    return `

      <button
        class="rider-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="accepted"
      >
        Accept Ride
      </button>

      <button
        class="rider-reject-btn"
        data-booking-id="${booking.id}"
      >
        Reject Ride
      </button>

    `;

  }

  if (
    booking.status === "accepted"
  ) {

    return `

      <button
        class="rider-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="in_progress"
      >
        Start Ride
      </button>

    `;

  }

  if (
    booking.status === "in_progress"
  ) {

    return `

      <button
        class="rider-action-btn"
        data-booking-id="${booking.id}"
        data-new-status="completed"
      >
        Complete Ride
      </button>

    `;

  }

  if (
    booking.status === "completed"
  ) {

    return `
      <p>
        <strong>
          Ride Completed
        </strong>
      </p>
    `;

  }

  if (
    booking.status === "cancelled"
  ) {

    return `
      <p>
        <strong>
          Ride Cancelled
        </strong>
      </p>
    `;

  }

  return "";

}

// ============================================================
// LOAD DRIVER RIDES
// ============================================================

async function loadDriverRides() {

  const driverList =
    document.getElementById(
      "driverList"
    );

  if (!driverList) {
    return;
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (
    userError ||
    !user
  ) {

    driverList.innerHTML = `
      <div class="card">
        Please log in as a driver.
      </div>
    `;

    return;

  }

  const {
    data: profile,
    error: profileError
  } = await supabase
    .from("profiles")
    .select(
      "role, vehicle_type, is_online"
    )
    .eq(
      "id",
      user.id
    )
    .maybeSingle();

  if (
    profileError ||
    profile?.role !== "driver"
  ) {

    driverList.innerHTML = `
      <div class="card">
        Driver access is not available for this account.
      </div>
    `;

    return;

  }

  const driverVehicle =
    normalizeVehicleType(
      profile.vehicle_type
    );

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .select("*")
    .eq(
      "driver_id",
      user.id
    )
    .eq(
      "service",
      driverVehicle
    )
    .in(
      "status",
      ACTIVE_RIDE_STATUSES
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Driver rides error:",
      error
    );

    driverList.innerHTML = `
      <div class="card">
        Could not load assigned rides.
      </div>
    `;

    return;

  }

  const customerProfiles =
    await loadCustomerProfiles(data);

  if (
    !data ||
    data.length === 0
  ) {

    driverList.innerHTML = `
      <div class="card">

        <p>
          <strong>
            Role:
          </strong>
          Driver
        </p>

        <p>
          <strong>
            Vehicle:
          </strong>
          ${vehicleDisplayName(driverVehicle)}
        </p>

        <p>
          <strong>
            Online:
          </strong>
          ${
            profile.is_online === true
              ? "Yes"
              : "No"
          }
        </p>

        <p>
          No assigned ${vehicleDisplayName(driverVehicle)} rides yet.
        </p>

      </div>
    `;

    return;

  }

  driverList.innerHTML =
    data.map(
      booking => {

        const customerProfile =
          customerProfiles[booking.user_id] || {};

        return `

        <div class="card">

          <h3>
            ${booking.pickup_location}
            →
            ${booking.destination}
          </h3>

          <p>
            <strong>
              Role:
            </strong>
            Driver
          </p>

          <p>
            <strong>
              Your Vehicle:
            </strong>
            ${vehicleDisplayName(driverVehicle)}
          </p>

          <p>
            <strong>
              Online:
            </strong>
            ${
              profile.is_online === true
                ? "Yes"
                : "No"
            }
          </p>

          <p>
            <strong>
              Service:
            </strong>
            ${vehicleDisplayName(booking.service)}
          </p>

          <p>
            <strong>
              Date:
            </strong>
            ${booking.booking_date || "-"}
          </p>

          <p>
            <strong>
              Time:
            </strong>
            ${booking.booking_time || "-"}
          </p>

          <p>
            <strong>
              Customer Phone:
            </strong>
            ${customerProfile.phone || "-"}
          </p>

          <p>
            <strong>
              Status:
            </strong>
            ${booking.status || "pending"}
          </p>

          ${getDriverAction(booking)}

        </div>

      `;
      }
    ).join("");

  document
    .querySelectorAll(
      ".driver-action-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const newStatus =
              event.currentTarget.dataset.newStatus;

            await updateDriverRideStatus(
              bookingId,
              newStatus
            );

          }
        );

      }
    );

  document
    .querySelectorAll(
      ".driver-reject-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const confirmed =
              confirm(
                "Are you sure you want to reject this ride?"
              );

            if (!confirmed) {
              return;
            }

            await updateDriverRideStatus(
              bookingId,
              "driver_rejected"
            );

          }
        );

      }
    );

}

// ============================================================
// LOAD BIKE RIDER RIDES
// ============================================================

async function loadRiderRides() {

  const targetList =
    riderList ||
    document.getElementById(
      "riderList"
    );

  if (!targetList) {
    return;
  }

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (
    userError ||
    !user
  ) {

    targetList.innerHTML = `
      <div class="card">
        Please log in as a bike rider.
      </div>
    `;

    return;

  }

  const {
    data: profile,
    error: profileError
  } = await supabase
    .from("profiles")
    .select(
      "role, vehicle_type, is_online"
    )
    .eq(
      "id",
      user.id
    )
    .maybeSingle();

  if (
    profileError ||
    profile?.role !== "rider"
  ) {

    targetList.innerHTML = `
      <div class="card">
        Rider access is not available for this account.
      </div>
    `;

    return;

  }

  const riderVehicle =
    normalizeVehicleType(
      profile.vehicle_type
    );

  if (
    riderVehicle !== "bike"
  ) {

    targetList.innerHTML = `
      <div class="card">
        Only Bike rider accounts can access the Rider Dashboard.
      </div>
    `;

    return;

  }

  const {
    data,
    error
  } = await supabase
    .from("bookings")
    .select("*")
    .eq(
      "driver_id",
      user.id
    )
    .eq(
      "service",
      "bike"
    )
    .in(
      "status",
      ACTIVE_RIDE_STATUSES
    )
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Rider rides error:",
      error
    );

    targetList.innerHTML = `
      <div class="card">
        Could not load assigned Bike rides.
      </div>
    `;

    return;

  }

  const customerProfiles =
    await loadCustomerProfiles(data);

  if (
    !data ||
    data.length === 0
  ) {

    targetList.innerHTML = `
      <div class="card">

        <p>
          <strong>
            Role:
          </strong>
          Rider
        </p>

        <p>
          <strong>
            Vehicle:
          </strong>
          Bike
        </p>

        <p>
          <strong>
            Online:
          </strong>
          ${
            profile.is_online === true
              ? "Yes"
              : "No"
          }
        </p>

        <p>
          No assigned Bike rides yet.
        </p>

      </div>
    `;

    return;

  }

  targetList.innerHTML =
    data.map(
      booking => {

        const customerProfile =
          customerProfiles[booking.user_id] || {};

        return `

        <div class="card">

          <h3>
            ${booking.pickup_location}
            →
            ${booking.destination}
          </h3>

          <p>
            <strong>
              Role:
            </strong>
            Rider
          </p>

          <p>
            <strong>
              Your Vehicle:
            </strong>
            Bike
          </p>

          <p>
            <strong>
              Online:
            </strong>
            ${
              profile.is_online === true
                ? "Yes"
                : "No"
            }
          </p>

          <p>
            <strong>
              Service:
            </strong>
            Bike
          </p>

          <p>
            <strong>
              Date:
            </strong>
            ${booking.booking_date || "-"}
          </p>

          <p>
            <strong>
              Time:
            </strong>
            ${booking.booking_time || "-"}
          </p>

          <p>
            <strong>
              Customer Phone:
            </strong>
            ${customerProfile.phone || "-"}
          </p>

          <p>
            <strong>
              Status:
            </strong>
            ${booking.status || "pending"}
          </p>

          ${getRiderAction(booking)}

        </div>

      `;
      }
    ).join("");

  document
    .querySelectorAll(
      ".rider-action-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const newStatus =
              event.currentTarget.dataset.newStatus;

            await updateDriverRideStatus(
              bookingId,
              newStatus
            );

          }
        );

      }
    );

  document
    .querySelectorAll(
      ".rider-reject-btn"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async event => {

            const bookingId =
              event.currentTarget.dataset.bookingId;

            const confirmed =
              confirm(
                "Are you sure you want to reject this Bike ride?"
              );

            if (!confirmed) {
              return;
            }

            await updateDriverRideStatus(
              bookingId,
              "driver_rejected"
            );

          }
        );

      }
    );

}

// ============================================================
// LOAD DRIVER / RIDER RIDE HISTORY
// ============================================================
//
// The bottom "Rides History" screen is shared by all logged-in
// roles. Customers see their own completed/cancelled bookings.
// Drivers and Riders see completed/cancelled bookings assigned
// to their account.
//
// Active rides never appear here. They remain on the Ride screen.
//

async function loadAssignedRideHistory(role) {

  if (!list) {
    return;
  }

  const user =
    currentAuthUser;

  if (!user) {
    list.innerHTML = `
      <div class="card">
        Please log in to see your ride history.
      </div>
    `;
    return;
  }

  if (
    role !== "driver" &&
    role !== "rider"
  ) {
    await loadRides();
    return;
  }

  const vehicle =
    role === "rider"
      ? "bike"
      : null;

  let query =
    supabase
      .from("bookings")
      .select("*")
      .eq("driver_id", user.id)
      .in(
        "status",
        [
          "completed",
          "cancelled"
        ]
      );

  if (vehicle) {
    query =
      query.eq(
        "service",
        vehicle
      );
  } else {
    query =
      query.in(
        "service",
        [
          "auto",
          "car"
        ]
      );
  }

  const {
    data,
    error
  } = await query.order(
    "created_at",
    {
      ascending: false
    }
  );

  if (error) {

    console.error(
      "Assigned ride history error:",
      error
    );

    list.innerHTML = `
      <div class="card">
        Could not load your ride history.
      </div>
    `;

    return;
  }

  if (
    !data ||
    data.length === 0
  ) {

    list.innerHTML = `
      <div class="card">
        No previous rides yet.
      </div>
    `;

    return;
  }

  list.innerHTML =
    data.map(
      booking => {

        const serviceName =
          vehicleDisplayName(
            normalizeVehicleType(
              booking.service
            )
          );

        const statusText =
          booking.status === "completed"
            ? "Completed"
            : "Cancelled";

        return `
          <div class="card">

            <h3>
              ${booking.pickup_location}
              →
              ${booking.destination}
            </h3>

            <p>
              <strong>
                Service:
              </strong>
              ${serviceName}
            </p>

            <p>
              <strong>
                Date:
              </strong>
              ${booking.booking_date || "-"}
            </p>

            <p>
              <strong>
                Time:
              </strong>
              ${booking.booking_time || "-"}
            </p>

            <p>
              <strong>
                Status:
              </strong>
              ${statusText}
            </p>

          </div>
        `;
      }
    ).join("");
}

// ============================================================
// AUTH STATE CHANGES
// ============================================================

supabase.auth.onAuthStateChange(
  (event, session) => {

    // Never await database/auth work directly inside the auth callback.

    if (event === "SIGNED_IN" && session?.user) {

      currentAuthUser = session.user;

      setTimeout(() => {

        updateAuthUI(session.user)
          .then(role => {

            // Do not block the login transition on online setup.
            if (role === "driver" || role === "rider") {

              setOnlineStatus(
                true,
                { refreshDashboard: false }
              ).catch(error => {
                console.error(
                  "Background online setup failed:",
                  error
                );
              });

            }

            syncMobileNavigationAfterAuth();

          })
          .catch(error => {
            console.error(
              "Authenticated UI update failed:",
              error
            );
          });

      }, 0);

      return;

    }

    if (event === "SIGNED_OUT") {

      currentAuthUser = null;
      currentAppRole = null;

      setTimeout(() => {

        updateAuthUI(null)
          .then(() => {
            syncMobileNavigationAfterAuth();
          })
          .catch(error => {
            console.error(
              "Logged-out UI update failed:",
              error
            );
          });

      }, 0);

      return;

    }

    if (event === "INITIAL_SESSION") {

      currentAuthUser = session?.user || null;

      setTimeout(() => {

        updateAuthUI(session?.user || null)
          .then(() => {
            syncMobileNavigationAfterAuth();
          })
          .catch(error => {
            console.error(
              "Initial authentication UI update failed:",
              error
            );
          });

      }, 0);

      return;

    }

    // TOKEN_REFRESHED and USER_UPDATED do not rebuild the application.

  }
);

// ============================================================
// MOBILE BOTTOM NAVIGATION
// ============================================================

function hideAllMobileSections() {

  [
    "home",
    "account",
    "book",
    "rides",
    "admin",
    "driver",
    "rider",
    "profile"
  ].forEach(
    id => {

      document
        .getElementById(id)
        ?.classList.add("hidden");

    }
  );

}

function setMobileNavActive(button) {

  [
    "lgRideNav",
    "lgServicesNav",
    "lgProfileNav"
  ].forEach(
    id => {

      const item =
        document.getElementById(id);

      item?.classList.toggle(
        "active",
        item === button
      );

    }
  );

}

function enterMobileNavMode(mode) {

  document.body.classList.remove(
    "lg-ride-active",
    "lg-services-active",
    "lg-profile-active"
  );

  document.body.classList.add(
    `lg-${mode}-active`
  );

  document.body.classList.add(
    "lg-mobile-mode"
  );

}

async function showMobileRideScreen() {

  /*
   * currentAppRole is established by updateAuthUI().
   * Do not use the section's current hidden state to determine
   * the role, because hideAllMobileSections() has just hidden it.
   */

  hideAllMobileSections();

  if (currentAppRole === "driver") {

    driverSection?.classList.remove("hidden");

    await loadDriverRides();

  } else if (currentAppRole === "rider") {

    riderSection?.classList.remove("hidden");

    await loadRiderRides();

  } else if (currentAppRole === "admin") {

    adminSection?.classList.remove("hidden");

    await loadAdminBookings();

  } else if (currentAppRole === "customer") {

    bookSection?.classList.remove("hidden");

    await loadUpcomingCustomerRides();
    await initializeLetsGoMap();

  } else {

    homeSection?.classList.remove("hidden");

  }

  setMobileNavActive(
    document.getElementById("lgRideNav")
  );

  enterMobileNavMode("ride");

}
async function showMobileHistoryScreen() {

  hideAllMobileSections();

  ridesSection?.classList.remove("hidden");

  const historyHeading =
    ridesSection?.querySelector(".heading h2");

  const historySubheading =
    ridesSection?.querySelector(".heading p");

  if (historyHeading) {
    historyHeading.textContent =
      "Rides History";
  }

  if (historySubheading) {

    if (currentAppRole === "customer") {

      historySubheading.textContent =
        "Your completed and previous rides.";

    } else if (currentAppRole === "rider") {

      historySubheading.textContent =
        "Your completed and cancelled Bike rides.";

    } else if (currentAppRole === "driver") {

      historySubheading.textContent =
        "Your completed and cancelled Auto/Car rides.";

    } else {

      historySubheading.textContent =
        "Your completed and previous rides.";

    }

  }

  if (
    currentAppRole === "customer"
  ) {

    await loadRides();

  } else if (
    currentAppRole === "rider" ||
    currentAppRole === "driver"
  ) {

    await loadAssignedRideHistory(
      currentAppRole
    );

  } else {

    list.innerHTML = `
      <div class="card">
        Ride history is not available for this account.
      </div>
    `;

  }

  enterMobileNavMode("services");

}

function showMobileProfileScreen() {

  hideAllMobileSections();

  document
    .getElementById("profile")
    ?.classList.remove("hidden");

  enterMobileNavMode("profile");

}

const mobileRideNav =
  document.getElementById("lgRideNav");

const mobileHistoryNav =
  document.getElementById("lgServicesNav");

const mobileProfileNav =
  document.getElementById("lgProfileNav");

/*
 * Capture-phase listeners take priority over the older navigation
 * bridge in the HTML. Only one navigation controller should decide
 * which section is visible.
 */

mobileRideNav?.addEventListener(
  "click",
  async event => {

    event.preventDefault();
    event.stopImmediatePropagation();

    setMobileNavActive(
      mobileRideNav
    );

    await showMobileRideScreen();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  },
  true
);

mobileHistoryNav?.addEventListener(
  "click",
  async event => {

    event.preventDefault();
    event.stopImmediatePropagation();

    setMobileNavActive(
      mobileHistoryNav
    );

    await showMobileHistoryScreen();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  },
  true
);

mobileProfileNav?.addEventListener(
  "click",
  event => {

    event.preventDefault();
    event.stopImmediatePropagation();

    setMobileNavActive(
      mobileProfileNav
    );

    showMobileProfileScreen();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  },
  true
);

// ============================================================
// SYNCHRONIZE MOBILE NAVIGATION AFTER AUTHENTICATION
// ============================================================

/*
 * The mobile navigation must be synchronized only AFTER the
 * authentication state and role have been established.
 *
 * Previously the page could enter mobile mode while every main
 * section was still hidden. That produced the blank screen shown
 * above the bottom navigation.
 *
 * This function does not perform another Supabase authentication
 * request and does not reload the dashboards. It only makes the
 * already-authorized screen visible.
 */

function syncMobileNavigationAfterAuth() {

  const nav =
    document.getElementById("lgBottomNav");

  const loggedIn =
    !!currentAuthUser;

  if (!loggedIn) {

    document.body.classList.remove(
      "lg-mobile-mode",
      "lg-ride-active",
      "lg-services-active",
      "lg-profile-active"
    );

    setMobileNavActive(null);

    return;

  }

  hideAllMobileSections();

  if (currentAppRole === "driver") {

    driverSection?.classList.remove("hidden");

  } else if (currentAppRole === "rider") {

    riderSection?.classList.remove("hidden");

  } else if (currentAppRole === "admin") {

    adminSection?.classList.remove("hidden");

  } else if (currentAppRole === "customer") {

    bookSection?.classList.remove("hidden");

  } else {

    // Authenticated but role is not available yet.
    // Never enter mobile mode with every section hidden.
    accountSection?.classList.remove("hidden");

    nav?.classList.remove("visible");

    return;

  }

  setMobileNavActive(
    document.getElementById("lgRideNav")
  );

  enterMobileNavMode("ride");

  nav?.classList.add("visible");

}

// ============================================================
// START APP
// ============================================================

updateAuthUI()
  .then(
  () => {

    /*
     * updateAuthUI() establishes currentAuthUser and
     * currentAppRole. Only after that do we activate the
     * authenticated mobile Ride screen.
     */
    syncMobileNavigationAfterAuth();

  }
  )
  .catch(error => {
    console.error(
      "Initial app authentication check failed:",
      error
    );
  });
