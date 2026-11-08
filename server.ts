import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Persistent database path
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'parking_db.json');

// Types
export interface User {
  id: string;
  fullName: string;
  email: string;
  password: string;
  createdAt: string;
}

export interface Slot {
  slotNumber: number;
  isOccupied: boolean;
  currentBookingId: string | null;
  vehicleNumber: string | null;
  vehicleType: 'Car' | 'Bike' | null;
  bookedByUserId: string | null;
  bookedByName: string | null;
  bookedAt: string | null;
}

export interface Booking {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  vehicleNumber: string;
  vehicleType: 'Car' | 'Bike';
  slotNumber: number;
  status: 'ACTIVE' | 'COMPLETED';
  bookedAt: string;
  bookedTimestamp: number;
  exitedAt?: string;
  durationMinutes?: number;
}

export interface QueueEntry {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  vehicleNumber: string;
  vehicleType: 'Car' | 'Bike';
  joinedAt: string;
  joinedTimestamp: number;
}

interface DatabaseSchema {
  users: User[];
  slots: Slot[];
  bookings: Booking[];
  queue: QueueEntry[];
}

// Initial 10 slots
function createDefaultSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let i = 1; i <= 10; i++) {
    slots.push({
      slotNumber: i,
      isOccupied: false,
      currentBookingId: null,
      vehicleNumber: null,
      vehicleType: null,
      bookedByUserId: null,
      bookedByName: null,
      bookedAt: null,
    });
  }
  return slots;
}

// Load and Save Database
function getDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initialDb: DatabaseSchema = {
        users: [
          {
            id: 'usr_sample_1',
            fullName: 'Alex Johnson',
            email: 'alex@example.com',
            password: 'password123',
            createdAt: new Date().toISOString(),
          },
        ],
        slots: createDefaultSlots(),
        bookings: [],
        queue: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf-8');
      return initialDb;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB file, fallback to defaults:', err);
    return {
      users: [],
      slots: createDefaultSlots(),
      bookings: [],
      queue: [],
    };
  }
}

function saveDb(data: DatabaseSchema) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing DB file:', err);
  }
}

// Token helper
function extractUserFromReq(req: express.Request): User | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const db = getDb();
  return db.users.find((u) => u.id === token || u.email === token) || null;
}

// ======================== API ROUTES ========================

// 1. Auth: Sign Up
app.post('/api/auth/signup', (req, res) => {
  const { fullName, email, password } = req.body;
  if (!fullName || !email || !password) {
    res.status(400).json({ error: 'Please provide name, email, and password.' });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  const db = getDb();

  const existing = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (existing) {
    res.status(400).json({ error: 'An account with this email already exists.' });
    return;
  }

  const newUser: User = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    fullName: fullName.trim(),
    email: cleanEmail,
    password: password.trim(),
    createdAt: new Date().toISOString(),
  };

  db.users.push(newUser);
  saveDb(db);

  res.json({
    success: true,
    token: newUser.id,
    user: {
      id: newUser.id,
      fullName: newUser.fullName,
      email: newUser.email,
    },
  });
});

// 2. Auth: Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Please provide email and password.' });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  const db = getDb();

  const user = db.users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!user || user.password !== password.trim()) {
    res.status(401).json({ error: 'Invalid email or password. Please try again.' });
    return;
  }

  res.json({
    success: true,
    token: user.id,
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
    },
  });
});

// 3. Auth: Current User
app.get('/api/auth/me', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  res.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
    },
  });
});

// 4. Parking Status & Grid
app.get('/api/parking/status', (req, res) => {
  const db = getDb();
  const user = extractUserFromReq(req);

  const occupiedCount = db.slots.filter((s) => s.isOccupied).length;
  const availableCount = 10 - occupiedCount;

  // Find if user is in waiting queue
  let userQueuePosition: number | null = null;
  if (user) {
    const qIndex = db.queue.findIndex((q) => q.userId === user.id);
    if (qIndex !== -1) {
      userQueuePosition = qIndex + 1;
    }
  }

  // Format slots for privacy (mask plates of other users if any)
  const clientSlots = db.slots.map((s) => {
    const isMine = user ? s.bookedByUserId === user.id : false;
    return {
      slotNumber: s.slotNumber,
      isOccupied: s.isOccupied,
      vehicleType: s.vehicleType,
      isCurrentUserSlot: isMine,
      vehicleNumber: isMine ? s.vehicleNumber : s.isOccupied ? 'Occupied' : null,
      bookedAt: isMine ? s.bookedAt : null,
    };
  });

  res.json({
    locationName: 'Central Plaza Parking Garage - Bay 1',
    totalSlots: 10,
    occupiedCount,
    availableCount,
    queueCount: db.queue.length,
    userQueuePosition,
    slots: clientSlots,
  });
});

// 5. Book a Parking Slot
app.post('/api/parking/book', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'You must be logged in to book a parking space.' });
    return;
  }

  const { slotNumber, vehicleNumber, vehicleType } = req.body;
  const numSlot = parseInt(slotNumber, 10);
  const cleanPlate = (vehicleNumber || '').trim().toUpperCase();
  const cleanType = vehicleType === 'Bike' ? 'Bike' : 'Car';

  if (!cleanPlate) {
    res.status(400).json({ error: 'Please enter a valid vehicle registration number.' });
    return;
  }

  if (isNaN(numSlot) || numSlot < 1 || numSlot > 10) {
    res.status(400).json({ error: 'Invalid parking space number (must be between 1 and 10).' });
    return;
  }

  const db = getDb();

  // Check 1: Does this vehicle already have an active reservation?
  const duplicateVehicle = db.bookings.find(
    (b) => b.status === 'ACTIVE' && b.vehicleNumber.toUpperCase() === cleanPlate
  );
  if (duplicateVehicle) {
    res.status(400).json({
      error: `Vehicle ${cleanPlate} already has an active reservation in Space #${duplicateVehicle.slotNumber}.`,
    });
    return;
  }

  // Check 2: Is this slot already occupied?
  const targetSlot = db.slots.find((s) => s.slotNumber === numSlot);
  if (!targetSlot) {
    res.status(400).json({ error: 'Slot not found.' });
    return;
  }

  if (targetSlot.isOccupied) {
    res.status(400).json({
      error: `Space #${numSlot} is already occupied or was just booked by another user. Please choose another space.`,
    });
    return;
  }

  // Check 3: If user was in waiting queue, remove them now
  db.queue = db.queue.filter((q) => q.userId !== user.id);

  // Allocate slot
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const newBooking: Booking = {
    id: 'BK-' + Date.now().toString().slice(-6),
    userId: user.id,
    userName: user.fullName,
    userEmail: user.email,
    vehicleNumber: cleanPlate,
    vehicleType: cleanType,
    slotNumber: numSlot,
    status: 'ACTIVE',
    bookedAt: timeStr + ', ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    bookedTimestamp: Date.now(),
  };

  targetSlot.isOccupied = true;
  targetSlot.currentBookingId = newBooking.id;
  targetSlot.vehicleNumber = cleanPlate;
  targetSlot.vehicleType = cleanType;
  targetSlot.bookedByUserId = user.id;
  targetSlot.bookedByName = user.fullName;
  targetSlot.bookedAt = newBooking.bookedAt;

  db.bookings.unshift(newBooking);
  saveDb(db);

  res.json({
    success: true,
    message: `Parking Space #${numSlot} successfully reserved for ${cleanPlate}.`,
    booking: newBooking,
  });
});

// 6. My Bookings (Only for current user)
app.get('/api/parking/my-bookings', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Please log in to view your bookings.' });
    return;
  }

  const db = getDb();
  const userBookings = db.bookings.filter((b) => b.userId === user.id);
  res.json({ bookings: userBookings });
});

// 7. Exit Parking
app.post('/api/parking/exit', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const { bookingId } = req.body;
  if (!bookingId) {
    res.status(400).json({ error: 'Booking ID is required.' });
    return;
  }

  const db = getDb();
  const booking = db.bookings.find((b) => b.id === bookingId && b.userId === user.id);
  if (!booking) {
    res.status(404).json({ error: 'Active booking not found.' });
    return;
  }

  if (booking.status === 'COMPLETED') {
    res.status(400).json({ error: 'This booking has already been exited.' });
    return;
  }

  const slot = db.slots.find((s) => s.slotNumber === booking.slotNumber);
  const now = new Date();
  const durationMinutes = Math.max(
    1,
    Math.round((Date.now() - (booking.bookedTimestamp || Date.now() - 60000)) / 60000)
  );

  booking.status = 'COMPLETED';
  booking.exitedAt = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  booking.durationMinutes = durationMinutes;

  let allocatedWaitingUser: QueueEntry | null = null;

  // Check FIFO Waiting Queue
  if (db.queue.length > 0) {
    allocatedWaitingUser = db.queue.shift()!;
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    const newWaitingBooking: Booking = {
      id: 'BK-' + Date.now().toString().slice(-6),
      userId: allocatedWaitingUser.userId,
      userName: allocatedWaitingUser.userName,
      userEmail: allocatedWaitingUser.userEmail,
      vehicleNumber: allocatedWaitingUser.vehicleNumber,
      vehicleType: allocatedWaitingUser.vehicleType,
      slotNumber: booking.slotNumber,
      status: 'ACTIVE',
      bookedAt: timeStr + ', ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      bookedTimestamp: Date.now(),
    };

    if (slot) {
      slot.isOccupied = true;
      slot.currentBookingId = newWaitingBooking.id;
      slot.vehicleNumber = allocatedWaitingUser.vehicleNumber;
      slot.vehicleType = allocatedWaitingUser.vehicleType;
      slot.bookedByUserId = allocatedWaitingUser.userId;
      slot.bookedByName = allocatedWaitingUser.userName;
      slot.bookedAt = newWaitingBooking.bookedAt;
    }
    db.bookings.unshift(newWaitingBooking);
  } else {
    // Slot becomes completely available
    if (slot) {
      slot.isOccupied = false;
      slot.currentBookingId = null;
      slot.vehicleNumber = null;
      slot.vehicleType = null;
      slot.bookedByUserId = null;
      slot.bookedByName = null;
      slot.bookedAt = null;
    }
  }

  saveDb(db);

  res.json({
    success: true,
    message: `You have successfully exited Space #${booking.slotNumber}.`,
    booking,
    allocatedToQueue: allocatedWaitingUser !== null,
  });
});

// 8. Join Waiting Queue (When full)
app.post('/api/parking/queue/join', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Please log in to join the waiting queue.' });
    return;
  }

  const { vehicleNumber, vehicleType } = req.body;
  const cleanPlate = (vehicleNumber || '').trim().toUpperCase();
  const cleanType = vehicleType === 'Bike' ? 'Bike' : 'Car';

  if (!cleanPlate) {
    res.status(400).json({ error: 'Please provide a valid vehicle registration number.' });
    return;
  }

  const db = getDb();

  // Check if vehicle already has active booking
  const activeBooking = db.bookings.find(
    (b) => b.status === 'ACTIVE' && b.vehicleNumber.toUpperCase() === cleanPlate
  );
  if (activeBooking) {
    res.status(400).json({
      error: `Vehicle ${cleanPlate} already has an active reservation in Space #${activeBooking.slotNumber}.`,
    });
    return;
  }

  // Check if vehicle or user is already in queue
  const inQueue = db.queue.find(
    (q) => q.userId === user.id || q.vehicleNumber.toUpperCase() === cleanPlate
  );
  if (inQueue) {
    const pos = db.queue.indexOf(inQueue) + 1;
    res.status(400).json({
      error: `You are already in the waiting list at Position #${pos}.`,
    });
    return;
  }

  const now = new Date();
  const entry: QueueEntry = {
    id: 'Q-' + Date.now(),
    userId: user.id,
    userName: user.fullName,
    userEmail: user.email,
    vehicleNumber: cleanPlate,
    vehicleType: cleanType,
    joinedAt: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    joinedTimestamp: Date.now(),
  };

  db.queue.push(entry);
  saveDb(db);

  res.json({
    success: true,
    message: `You have joined the waiting queue at Position #${db.queue.length}.`,
    position: db.queue.length,
  });
});

// 9. Leave Waiting Queue
app.post('/api/parking/queue/leave', (req, res) => {
  const user = extractUserFromReq(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const db = getDb();
  db.queue = db.queue.filter((q) => q.userId !== user.id);
  saveDb(db);

  res.json({ success: true, message: 'You have left the waiting queue.' });
});

// 10. Reset/Clear for testing if needed
app.post('/api/parking/reset', (req, res) => {
  const db: DatabaseSchema = {
    users: getDb().users,
    slots: createDefaultSlots(),
    bookings: [],
    queue: [],
  };
  saveDb(db);
  res.json({ success: true, message: 'Parking lot reset to 10 available spaces.' });
});

// ======================== VITE & STATIC HANDLING ========================
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Parking Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
