const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const session = require("express-session");
const RedisStore = require("connect-redis").default;
const redis = require("redis");
const rateLimit = require("express-rate-limit");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Replace with your actual Redis URL from Render
const REDIS_URL = "redis://red-crin5mu8ii6s73f6h2rg:6379";

let redisClient = redis.createClient({ url: REDIS_URL });

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

redisClient.on("ready", () => {
  console.log("Redis client connected");
});

// Session middleware configuration
const isProduction = process.env.NODE_ENV === "production";
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "default-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProduction },
  })
);

// Rate limiter middleware for HTTP requests
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Simple HTTP route
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html"); // Serve the frontend HTML
});

const connectedClients = {}; // Maintain a map of connected clients

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("Client connected");

  const clientId = Math.random().toString(36).substring(2, 15); // Generate unique ID
  connectedClients[clientId] = ws;

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received message:", data);

      // Rate limiting for WebSocket messages
      const rateLimited = await isRateLimited(ws);
      if (rateLimited) {
        ws.send(JSON.stringify({ error: "Rate limit exceeded" }));
        return;
      }

      // Handle heartbeat and message priority
      if (data.priority) {
        handlePriorityMessage(ws, data);
      } else {
        // Broadcast message to all connected clients (excluding sender)
        for (const id in connectedClients) {
          if (id !== clientId) {
            connectedClients[id].send(JSON.stringify(data));
          }
        }
      }

      // Simulate heartbeat
      heartbeat(ws);
    } catch (err) {
      console.error("Message handling error:", err);
      ws.send(JSON.stringify({ error: "Internal server error" }));
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    delete connectedClients[clientId];
  });

  // Send a heartbeat every 30 seconds (adjust as needed)
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat" }));
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 30000);
});

// Rate limiting check for WebSocket messages using Redis
async function isRateLimited(ws) {
  const ip = ws._socket.remoteAddress;
  const rateLimitKey = `rate_limit_${ip}`;

  try {
    const count = await redisClient.get(rateLimitKey);
    if (count && parseInt(count) >= 5) {
      return true;
    }

    // Increment the count and set expiration (1 minute)
    await redisClient.incr(rateLimitKey);
    await redisClient.expire(rateLimitKey, 60);
    return false;
  } catch (err) {
    console.error("Rate limit error:", err);
    return false;
  }
}

// Handle priority messages
function handlePriorityMessage(ws, message) {
  if (message.priority === "high") {
    ws.send(
      JSON.stringify({
        type: "priority",
        message: "High priority message handled",
      })
    );
  }
}

// Heartbeat function
function heartbeat(ws) {
  ws.send(JSON.stringify({ type: "heartbeat" }));
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
