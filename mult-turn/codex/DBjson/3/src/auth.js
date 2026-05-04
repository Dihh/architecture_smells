import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET || "development-secret";

export function signAuthToken(user) {
  return jwt.sign(toPublicUser(user), jwtSecret, { expiresIn: "1h" });
}

export function authenticateToken(req, res, next) {
  const authorization = req.get("authorization");

  if (!authorization) {
    return res.status(401).json({ error: "Authorization header is required" });
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Bearer token is required" });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = toPublicUser(decoded);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}
