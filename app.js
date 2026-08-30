import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

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

const logoutBtn =
  document.getElementById("logoutBtn");

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

const bookingDate =
  document.getElementById("bookingDate");

const bookingTime =
  document.getElementById("bookingTime");

const phone =
  document.getElementById("phone");

const bookBtn =
  document.getElementById("bookBtn");

const status =
  document.getElementById("status");

const list =
  document.getElementById("list");

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

    // Logged-in users should never see Log In / Sign Up.
    // Keep one clear header action available so every role can log out.
    headerLoginBtn?.classList.remove("hidden");

    headerLoginBtn.textContent = "Log Out";

    headerLoginBtn.setAttribute("href", "#");

    headerSignupBtn?.classList.add("hidden");

  } else {

    // Logged-out visitors see the public authentication buttons.
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

  // Keep Account visible so the user can see Log Out.
  accountSection?.classList.remove("hidden");

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

  bookSection?.classList.remove("hidden");

  ridesSection?.classList.remove("hidden");

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

  console.log(
    "Starting automatic assignment:",
    bookingId
  );

  const {
    data: booking,
    error: bookingError
  } = await supabase
    .from("bookings")
    .select(
      "id, service, driver_id, status, rejected_driver_ids"
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

    return null;

  }

  if (!booking) {

    console.error(
      "Booking not found."
    );

    return null;

  }

  if (booking.driver_id) {

    return booking.driver_id;

  }

  if (
    booking.status === "cancelled" ||
    booking.status === "completed"
  ) {

    return null;

  }

  const requiredVehicle =
    normalizeVehicleType(
      booking.service
    );

  if (
    ![
      "auto",
      "bike",
      "car"
    ].includes(
      requiredVehicle
    )
  ) {

    console.error(
      "Invalid vehicle type:",
      booking.service
    );

    return null;

  }

  const requiredRole =
    requiredRoleForVehicle(
      requiredVehicle
    );

  const rejectedDriverIds =
    Array.isArray(
      booking.rejected_driver_ids
    )
      ? booking.rejected_driver_ids
      : [];

  const {
    data: people,
    error: peopleError
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, phone, vehicle_type, role, is_online"
    )
    .eq(
      "role",
      requiredRole
    )
    .eq(
      "vehicle_type",
      requiredVehicle
    )
    .eq(
      "is_online",
      true
    )
    .order(
      "full_name"
    );

  if (peopleError) {

    console.error(
      "Could not load matching online people:",
      peopleError
    );

    return null;

  }

  if (
    !people ||
    people.length === 0
  ) {

    console.log(
      "No matching ONLINE people found."
    );

    return null;

  }

  for (
    const person of people
  ) {

    if (
      person.is_online !== true
    ) {

      continue;

    }

    if (
      normalizeVehicleType(
        person.vehicle_type
      ) !== requiredVehicle
    ) {

      continue;

    }

    if (
      person.role !== requiredRole
    ) {

      continue;

    }

    if (
      rejectedDriverIds.includes(
        person.id
      )
    ) {

      console.log(
        "Skipping previously rejected person:",
        person.id
      );

      continue;

    }

    const available =
      await isDriverAvailable(
        person.id
      );

    if (!available) {

      console.log(
        "Person currently has an active ride:",
        person.id
      );

      continue;

    }

    const {
      data: updatedBooking,
      error: assignmentError
    } = await supabase
      .from("bookings")
      .update({
        driver_id: person.id
      })
      .eq(
        "id",
        bookingId
      )
      .is(
        "driver_id",
        null
      )
      .select(
        "id, driver_id"
      )
      .maybeSingle();

    if (assignmentError) {

      console.error(
        "Automatic assignment failed:",
        assignmentError
      );

      continue;

    }

    if (
      updatedBooking &&
      updatedBooking.driver_id === person.id
    ) {

      console.log(
        "Matching ONLINE person assigned:",
        person.id,
        "role:",
        requiredRole,
        "vehicle:",
        requiredVehicle
      );

      return person.id;

    }

  }

  console.log(
    "No available ONLINE matching person found."
  );

  return null;

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

  const {
    data: person,
    error: personError
  } = await supabase
    .from("profiles")
    .select(
      "id, full_name, role, vehicle_type, is_online"
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
      "Could not load online person:",
      personError
    );

    return;

  }

  if (
    person.is_online !== true
  ) {

    return;

  }

  if (
    person.role !== "driver" &&
    person.role !== "rider"
  ) {

    return;

  }

  const personVehicle =
    normalizeVehicleType(
      person.vehicle_type
    );

  if (
    ![
      "auto",
      "bike",
      "car"
    ].includes(
      personVehicle
    )
  ) {

    return;

  }

  const requiredRole =
    requiredRoleForVehicle(
      personVehicle
    );

  if (
    person.role !== requiredRole
  ) {

    return;

  }

  console.log(
    "Checking existing pending bookings for:",
    person.full_name || person.id,
    personVehicle
  );

  const {
    data: pendingBookings,
    error: bookingsError
  } = await supabase
    .from("bookings")
    .select(
      "id, service, driver_id, status, rejected_driver_ids"
    )
    .eq(
      "status",
      "pending"
    )
    .is(
      "driver_id",
      null
    )
    .eq(
      "service",
      personVehicle
    )
    .order(
      "created_at",
      {
        ascending: true
      }
    );

  if (bookingsError) {

    console.error(
      "Could not load pending bookings:",
      bookingsError
    );

    return;

  }

  if (
    !pendingBookings ||
    pendingBookings.length === 0
  ) {

    console.log(
      "No pending matching bookings found."
    );

    return;

  }

  for (
    const booking of pendingBookings
  ) {

    if (
      booking.status !== "pending" ||
      booking.driver_id
    ) {

      continue;

    }

    const requiredVehicle =
      normalizeVehicleType(
        booking.service
      );

    if (
      requiredVehicle !== personVehicle
    ) {

      continue;

    }

    const rejectedDriverIds =
      Array.isArray(
        booking.rejected_driver_ids
      )
        ? booking.rejected_driver_ids
        : [];

    if (
      rejectedDriverIds.includes(
        person.id
      )
    ) {

      console.log(
        "This person rejected this booking before. Skipping:",
        booking.id
      );

      continue;

    }

    const available =
      await isDriverAvailable(
        person.id
      );

    if (!available) {

      console.log(
        "Person became unavailable. Stopping pending assignment."
      );

      break;

    }

    const {
      data: assignedBooking,
      error: assignmentError
    } = await supabase
      .from("bookings")
      .update({
        driver_id: person.id
      })
      .eq(
        "id",
        booking.id
      )
      .eq(
        "status",
        "pending"
      )
      .is(
        "driver_id",
        null
      )
      .select(
        "id, driver_id"
      )
      .maybeSingle();

    if (assignmentError) {

      console.error(
        "Could not assign pending booking:",
        assignmentError
      );

      continue;

    }

    if (
      assignedBooking &&
      assignedBooking.driver_id === person.id
    ) {

      console.log(
        "Existing pending booking assigned after going online:",
        booking.id
      );

      break;

    }

  }

}

// ============================================================
// SET DRIVER / RIDER ONLINE STATUS
// ============================================================

async function setOnlineStatus(
  isOnline
) {

  const {
    data: { user }
  } = await supabase.auth.getUser();

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

  // ==========================================================
  // IMPORTANT:
  // WHEN A DRIVER/RIDER GOES ONLINE,
  // CHECK EXISTING PENDING BOOKINGS.
  // ==========================================================

  if (isOnline) {

    await assignPendingBookingsForOnlinePerson(
      user.id
    );

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

async function updateAuthUI() {

  const {
    data: { user }
  } = await supabase.auth.getUser();

  updateHeaderAuthUI(!!user);

  if (user) {

    showLoggedInApp();

    authBox?.classList.add("hidden");

    loggedInBox?.classList.remove("hidden");

    const logoutButton =
      ensureLogoutButton();

    if (logoutButton) {

      logoutButton.disabled = false;
      logoutButton.textContent = "Log Out";

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

    if (role === "customer") {

      await loadRides();

    }

  } else {

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

      await updateAuthUI();

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

    await setOnlineStatus(true);

    if (authStatus) {

      authStatus.textContent =
        "Login successful.";

    }

    await updateAuthUI();

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

// Create a visible logout button when the logged-in account
// area does not already contain one.
//
// This keeps logout available even if the HTML does not
// currently contain #logoutBtn.

let activeLogoutBtn =
  logoutBtn;

function ensureLogoutButton() {

  if (activeLogoutBtn) {

    return activeLogoutBtn;

  }

  const existingButton =
    document.getElementById(
      "logoutBtn"
    );

  if (existingButton) {

    activeLogoutBtn =
      existingButton;

    return activeLogoutBtn;

  }

  const button =
    document.createElement("button");

  button.id =
    "logoutBtn";

  button.type =
    "button";

  button.className =
    "btn logout-visible-btn";

  button.textContent =
    "Log Out";

  button.setAttribute(
    "aria-label",
    "Log Out"
  );

  // Prefer the logged-in account box.
  if (loggedInBox) {

    loggedInBox.appendChild(
      button
    );

  }

  // If there is no logged-in box,
  // place it in the Account section.
  else if (accountSection) {

    accountSection.appendChild(
      button
    );

  }

  activeLogoutBtn =
    button;

  return activeLogoutBtn;

}

async function performLogout() {

  const button =
    ensureLogoutButton();

  if (button) {

    button.disabled =
      true;

    button.textContent =
      "Logging Out...";

  }

  // Drivers and Bike riders must go offline
  // before their Supabase session is removed.
  await setOnlineStatus(false);

  const {
    error
  } =
    await supabase.auth.signOut();

  if (error) {

    console.error(
      "Logout error:",
      error
    );

    if (authStatus) {

      authStatus.textContent =
        "Logout failed: " +
        error.message;

    }

    if (button) {

      button.disabled =
        false;

      button.textContent =
        "Log Out";

    }

    return;

  }

  if (authStatus) {

    authStatus.textContent =
      "";

  }

  if (email) {

    email.value =
      "";

  }

  if (password) {

    password.value =
      "";

  }

  if (signupEmail) {

    signupEmail.value =
      "";

  }

  if (signupPassword) {

    signupPassword.value =
      "";

  }

  await updateAuthUI();

}

// Existing HTML logout button.
logoutBtn?.addEventListener(
  "click",
  async event => {

    event.preventDefault();

    await performLogout();

  }
);

// If the HTML does not contain #logoutBtn,
// create a visible one automatically.
ensureLogoutButton();

// Header Log In button becomes Log Out when authenticated.
headerLoginBtn?.addEventListener(
  "click",
  async event => {

    event.preventDefault();

    const {
      data: { user }
    } =
      await supabase.auth.getUser();

    if (user) {

      await performLogout();

      return;

    }

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

    const dateValue =
      bookingDate?.value;

    const timeValue =
      bookingTime?.value;

    const phoneValue =
      phone?.value.trim();

    if (
      !pickupValue ||
      !destinationValue ||
      !dateValue ||
      !timeValue ||
      !phoneValue
    ) {

      if (status) {

        status.textContent =
          "Please fill in all fields.";

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

        booking_date: dateValue,

        booking_time: timeValue,

        phone: phoneValue,

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

    if (bookingDate)
      bookingDate.value = "";

    if (bookingTime)
      bookingTime.value = "";

    if (phone)
      phone.value = "";

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

    await loadRides();

    await checkUserRole();

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

  await loadRides();

}

// ============================================================
// LOAD USER RIDES
// ============================================================

async function loadRides() {

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !list) {
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
    .order(
      "created_at",
      {
        ascending: false
      }
    );

  if (error) {

    console.error(
      "Load rides error:",
      error
    );

    list.innerHTML = `
      <div class="card">
        Could not load your rides.
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
        No rides yet.
      </div>
    `;

    return;

  }

  list.innerHTML =
    data.map(
      booking => {

        const cancelButton =
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
              ${vehicleDisplayName(booking.service)}

              <br>

              Date:
              ${booking.booking_date || ""}

              <br>

              Time:
              ${booking.booking_time || ""}
            </p>

            ${cancelButton}

          </div>
        `;

      }
    ).join("");

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
                Phone:
              </strong>
              ${booking.phone || "-"}
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

    const oldRejectedIds =
      Array.isArray(
        booking.rejected_driver_ids
      )
        ? booking.rejected_driver_ids
        : [];

    const rejectedDriverIds =
      oldRejectedIds.includes(
        user.id
      )
        ? oldRejectedIds
        : [
            ...oldRejectedIds,
            user.id
          ];

    // IMPORTANT:
    // The rejected driver/rider must be detached from the booking.
    // The rejection is recorded only for this specific booking.
    // The person remains eligible for future bookings.

    const {
      error: rejectionError
    } = await supabase
      .from("bookings")
      .update({

        status: "pending",

        driver_id: null,

        rejected_driver_ids:
          rejectedDriverIds

      })
      .eq(
        "id",
        bookingId
      )
      .eq(
        "driver_id",
        user.id
      );

    if (rejectionError) {

      console.error(
        "Rejection error:",
        rejectionError
      );

      if (statusElement) {

        statusElement.textContent =
          "Rejection failed: " +
          rejectionError.message;

      }

      return;

    }

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
      booking => `

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
            ${booking.phone || "-"}
          </p>

          <p>
            <strong>
              Status:
            </strong>
            ${booking.status || "pending"}
          </p>

          ${getDriverAction(booking)}

        </div>

      `
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
      booking => `

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
            ${booking.phone || "-"}
          </p>

          <p>
            <strong>
              Status:
            </strong>
            ${booking.status || "pending"}
          </p>

          ${getRiderAction(booking)}

        </div>

      `
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
// AUTH STATE CHANGES
// ============================================================

supabase.auth.onAuthStateChange(
  async (
    event,
    session
  ) => {

    if (
      event === "SIGNED_IN" &&
      session?.user
    ) {

      setTimeout(
        async () => {

          await setOnlineStatus(true);

          await updateAuthUI();

        },
        0
      );

      return;

    }

    if (
      event === "SIGNED_OUT"
    ) {

      await updateAuthUI();

      return;

    }

    await updateAuthUI();

  }
);

// ============================================================
// START APP
// ============================================================

updateAuthUI();