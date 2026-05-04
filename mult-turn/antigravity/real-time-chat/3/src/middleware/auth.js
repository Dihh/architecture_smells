import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'premium-secret-key-123';

/**
 * Authentication Middleware
 * Verifies the JWT token from the Authorization header.
 * Attaches the user object (userId, username) to the request.
 */
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  // Format should be "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach the user info to the request object
    req.user = {
      userId: decoded.userId,
      username: decoded.username
    };

    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error.message);
    return res.status(401).json({ error: "Unauthorized" });
  }
};

/**
 * Helper to verify token (useful for WebSockets later)
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};
