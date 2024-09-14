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
const cors = require("cors");

// Replace with your actual Redis URL from Render
const REDIS_URL = "redis://red-crin5mu8ii6s73f6h2rg:6379";

let redisClient = redis.createClient({ url: REDIS_URL });
let redisPublisher = redisClient.duplicate();

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
});

redisClient.on("ready", () => {
  console.log("Redis client connected");
});

// Session middleware configuration
const isProduction = process.env.NODE_ENV === "production";
app.use(
  cors({
    origin: "https://websocketmanager.netlify.app/",
    credentials: true,
  })
);

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
  max: 5,
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Simple HTTP route
app.get("/", (req, res) => {
  res.send("WebSocket application backend is running!"); // Serve the frontend HTML
});

const connectedClients = {};

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("Client connected");

  const clientId = Math.random().toString(36).substring(2, 15); // Generate unique ID
  connectedClients[clientId] = ws;

  // Notify other instances about the new client connection
  redisPublisher.publish(
    "broadcast",
    JSON.stringify({
      event: "client_connected",
      clientId,
    })
  );

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
    redisPublisher.publish(
      "broadcast",
      JSON.stringify({ event: "client_disconnected", clientId })
    );
  });

  // Send a dynamic heartbeat based on load
  let heartbeatIntervalTime = 30000; // Default interval
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat" }));
    } else {
      clearInterval(heartbeatInterval);
    }
  }, heartbeatIntervalTime);

  // Adjust heartbeat interval based on load
  setInterval(() => {
    const connectedClientsCount = Object.keys(connectedClients).length;
    heartbeatIntervalTime = connectedClientsCount > 100 ? 60000 : 30000; // Increase interval if overloaded
  }, 60000); // Check every minute
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

redisPublisher.subscribe("broadcast");
redisPublisher.on("message", (channel, message) => {
  if (channel === "broadcast") {
    const data = JSON.parse(message);
    if (
      data.event === "client_connected" ||
      data.event === "client_disconnected"
    ) {
      console.log(`Broadcast event received: ${data.event}`);
      for (const id in connectedClients) {
        connectedClients[id].send(JSON.stringify(data));
      }
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
