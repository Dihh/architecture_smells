import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import express from "express";
import { authenticateToken, signAuthToken, toPublicUser } from "./auth.js";

export function createAuthRouter(db) {
  const router = express.Router();

  router.post("/register", async (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await db.write((data) => {
        if (!Array.isArray(data._users)) {
          data._users = [];
        }

        const usernameTaken = data._users.some((user) => user.username === username);

        if (usernameTaken) {
          return { error: "username_taken" };
        }

        const user = {
          id: randomUUID(),
          username,
          passwordHash,
          role: data._users.length === 0 ? "admin" : "user"
        };

        data._users.push(user);

        return { user: toPublicUser(user) };
      });

      if (result.error === "username_taken") {
        return res.status(409).json({ error: "Username is already taken" });
      }

      return res.status(201).json(result.user);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await db.read((data) => {
        const users = Array.isArray(data._users) ? data._users : [];
        return users.find((candidate) => candidate.username === username) ?? null;
      });

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      const token = signAuthToken(user);

      return res.status(200).json({ token });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", authenticateToken, (req, res) => {
    return res.status(200).json(req.user);
  });

  router.post("/teams", authenticateToken, async (req, res, next) => {
    try {
      const { name } = req.body ?? {};

      if (!name) {
        return res.status(400).json({ error: "Team name is required" });
      }

      const team = await db.write((data) => {
        if (!Array.isArray(data._teams)) {
          data._teams = [];
        }

        const team = {
          id: randomUUID(),
          name,
          ownerId: req.user.id,
          members: [req.user.id]
        };

        data._teams.push(team);

        return team;
      });

      return res.status(201).json(team);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/teams", authenticateToken, async (req, res, next) => {
    try {
      const teams = await db.read((data) => {
        return getTeams(data).filter((team) => isTeamMember(req.user, team));
      });

      return res.status(200).json(teams);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/teams/:id", authenticateToken, async (req, res, next) => {
    try {
      const team = await db.read((data) => {
        return findTeam(getTeams(data), req.params.id);
      });

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      if (!isTeamMember(req.user, team)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return res.status(200).json(team);
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/teams/:id", authenticateToken, async (req, res, next) => {
    try {
      const { name } = req.body ?? {};

      if (!name) {
        return res.status(400).json({ error: "Team name is required" });
      }

      const result = await db.write((data) => {
        const team = findTeam(getTeams(data), req.params.id);

        if (!team) {
          return { status: "not_found" };
        }

        if (!isTeamOwner(req.user, team)) {
          return { status: "forbidden" };
        }

        team.name = name;
        return { status: "ok", team };
      });

      return sendTeamResult(res, result);
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/teams/:id", authenticateToken, async (req, res, next) => {
    try {
      const result = await db.write((data) => {
        const teams = getTeams(data);
        const index = teams.findIndex((team) => String(team.id) === String(req.params.id));

        if (index === -1) {
          return { status: "not_found" };
        }

        if (!isTeamOwner(req.user, teams[index])) {
          return { status: "forbidden" };
        }

        teams.splice(index, 1);
        data._teams = teams;

        return { status: "ok" };
      });

      if (result.status === "not_found") {
        return res.status(404).json({ error: "Team not found" });
      }

      if (result.status === "forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }

      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  router.post("/teams/:id/members", authenticateToken, async (req, res, next) => {
    try {
      const { userId } = req.body ?? {};

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await db.write((data) => {
        const team = findTeam(getTeams(data), req.params.id);

        if (!team) {
          return { status: "not_found" };
        }

        if (!isAdmin(req.user) && !isTeamOwner(req.user, team)) {
          return { status: "forbidden" };
        }

        if (!team.members.some((memberId) => String(memberId) === String(userId))) {
          team.members.push(userId);
        }

        return { status: "ok", team };
      });

      return sendTeamResult(res, result);
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/teams/:id/members/:userId", authenticateToken, async (req, res, next) => {
    try {
      const result = await db.write((data) => {
        const team = findTeam(getTeams(data), req.params.id);

        if (!team) {
          return { status: "not_found" };
        }

        if (!isTeamOwner(req.user, team)) {
          return { status: "forbidden" };
        }

        team.members = team.members.filter((memberId) => {
          return String(memberId) !== String(req.params.userId);
        });

        return { status: "ok", team };
      });

      return sendTeamResult(res, result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function getTeams(data) {
  if (!Array.isArray(data._teams)) {
    data._teams = [];
  }

  return data._teams;
}

function findTeam(teams, id) {
  return teams.find((team) => String(team.id) === String(id)) ?? null;
}

function isAdmin(user) {
  return user.role === "admin";
}

function isTeamOwner(user, team) {
  return String(team.ownerId) === String(user.id);
}

function isTeamMember(user, team) {
  return Array.isArray(team.members)
    && team.members.some((memberId) => String(memberId) === String(user.id));
}

function sendTeamResult(res, result) {
  if (result.status === "not_found") {
    return res.status(404).json({ error: "Team not found" });
  }

  if (result.status === "forbidden") {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.status(200).json(result.team);
}
