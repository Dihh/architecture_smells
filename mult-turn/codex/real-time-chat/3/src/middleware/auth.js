import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-development-secret";

export function signAuthToken(user) {
  return jwt.sign(
    {
      userId: user.userId,
      username: user.username,
    },
    JWT_SECRET,
  );
}

export function verifyAuthToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (
    !Number.isInteger(decoded.userId) ||
    typeof decoded.username !== "string" ||
    decoded.username.length === 0
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    userId: decoded.userId,
    username: decoded.username,
  };
}

export function authenticateToken(req, res, next) {
  const authHeader = req.get("Authorization");
  const [scheme, token] = authHeader?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = verifyAuthToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}
