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

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
});
redisClient.on("error", (err) => console.error("Redis error:", err));

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
  res.send("WebSocket server is running");
});

// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("Client connected");

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
      }

      // Simulate heartbeat
      heartbeat(ws);
    } catch (err) {
      console.error("Message handling error:", err);
    }
  });

  ws.on("close", () => console.log("Client disconnected"));

  // Send a heartbeat every 30 seconds
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "heartbeat" }));
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 30000);
});

// Rate limiting check for WebSocket messages
async function isRateLimited(ws) {
  const ip = ws._socket.remoteAddress;
  const rateLimitKey = `rate_limit_${ip}`; // Fixed syntax
  try {
    const count = await redisClient.get(rateLimitKey);
    return count && parseInt(count) >= 5;
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
  console.log(`Server running on port ${PORT}`); // Fixed syntax
});
