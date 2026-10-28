const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || "4173", 10);
const ENV = loadEnvFile(path.join(ROOT, ".env"));
const SESSION_FILE = path.join(ROOT, ".soundcloud-session.json");
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8"
};

const CONFIG = {
    clientId: readConfig("SOUNDCLOUD_CLIENT_ID"),
    clientSecret: readConfig("SOUNDCLOUD_CLIENT_SECRET"),
    redirectUri: readConfig("SOUNDCLOUD_REDIRECT_URI") || `http://localhost:${PORT}/auth/callback`,
    dashboardUsername: readConfig("DASHBOARD_USERNAME"),
    dashboardPassword: readConfig("DASHBOARD_PASSWORD")
};

let tokenState = loadJson(SESSION_FILE, null);
let pendingAuth = null;

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host}`);

        if (request.method === "OPTIONS") {
            return sendEmpty(response, 204);
        }

        if (!isAuthorized(request)) {
            return requestAuthentication(response);
        }

        if (url.pathname === "/auth/login") {
            return handleLogin(response);
        }
        if (url.pathname === "/auth/callback") {
            return handleCallback(url, response);
        }
        if (url.pathname === "/auth/status") {
            return handleStatus(response);
        }
        if (url.pathname === "/auth/logout" && request.method === "POST") {
            clearSession();
            return sendJson(response, 200, { ok: true });
        }
        if (url.pathname === "/api/me") {
            return handleMe(response);
        }
        if (url.pathname === "/api/tracks") {
            return handleTracks(response);
        }

        return serveStatic(url.pathname, response);
    } catch (error) {
        return sendJson(response, 500, {
            message: error.message || "Unexpected server error."
        });
    }
});

server.listen(PORT, () => {
    console.log(`SoundCloud Command Center server running on http://localhost:${PORT}`);

    if (isDashboardProtected()) {
        console.log("Dashboard basic auth is enabled.");
    } else if (CONFIG.dashboardUsername || CONFIG.dashboardPassword) {
        console.warn("Dashboard basic auth is disabled because both DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set.");
    }
});

function readConfig(key) {
    return process.env[key] || ENV[key] || "";
}

function loadEnvFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf8");
        return content.split(/\r?\n/).reduce((accumulator, line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
                return accumulator;
            }

            const separator = trimmed.indexOf("=");
            const key = trimmed.slice(0, separator).trim();
            const value = trimmed.slice(separator + 1).trim().replace(/^['\"]|['\"]$/g, "");
            accumulator[key] = value;
            return accumulator;
        }, {});
    } catch (error) {
        return {};
    }
}

function loadJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
        return fallback;
    }
}

function saveSession(nextState) {
    tokenState = nextState;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(nextState, null, 2));
}

function clearSession() {
    tokenState = null;
    if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
    }
}

function isConfigured() {
    return Boolean(CONFIG.clientId && CONFIG.clientSecret && CONFIG.redirectUri);
}

function isDashboardProtected() {
    return Boolean(CONFIG.dashboardUsername && CONFIG.dashboardPassword);
}

function isAuthorized(request) {
    if (!isDashboardProtected()) {
        return true;
    }

    const authorization = request.headers.authorization || "";
    if (!authorization.startsWith("Basic ")) {
        return false;
    }

    try {
        const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");

        if (separatorIndex < 0) {
            return false;
        }

        const username = decoded.slice(0, separatorIndex);
        const password = decoded.slice(separatorIndex + 1);

        return safeEqual(username, CONFIG.dashboardUsername) && safeEqual(password, CONFIG.dashboardPassword);
    } catch (error) {
        return false;
    }
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));

    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(payload, null, 2));
}

function sendRedirect(response, location) {
    response.writeHead(302, {
        "Access-Control-Allow-Origin": "*",
        Location: location
    });
    response.end();
}

function sendEmpty(response, statusCode) {
    response.writeHead(statusCode, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store"
    });
    response.end();
}

function requestAuthentication(response) {
    response.writeHead(401, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="SoundCloud Command Center", charset="UTF-8"'
    });
    response.end(JSON.stringify({ message: "Authentication required." }, null, 2));
}

async function handleLogin(response) {
    if (!isConfigured()) {
        return sendRedirect(response, "/overview.html?error=missing-config");
    }

    const verifier = base64UrlEncode(crypto.randomBytes(48));
    const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
    const state = base64UrlEncode(crypto.randomBytes(24));

    pendingAuth = {
        state,
        verifier,
        createdAt: Date.now()
    };

    const authorizeUrl = new URL("https://secure.soundcloud.com/authorize");
    authorizeUrl.searchParams.set("client_id", CONFIG.clientId);
    authorizeUrl.searchParams.set("redirect_uri", CONFIG.redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);

    return sendRedirect(response, authorizeUrl.toString());
}

async function handleCallback(url, response) {
    if (!isConfigured()) {
        return sendRedirect(response, "/overview.html?error=missing-config");
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !pendingAuth || pendingAuth.state !== state) {
        pendingAuth = null;
        return sendRedirect(response, "/overview.html?error=invalid-auth");
    }

    try {
        const tokenPayload = await requestToken(new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CONFIG.clientId,
            client_secret: CONFIG.clientSecret,
            redirect_uri: CONFIG.redirectUri,
            code_verifier: pendingAuth.verifier,
            code
        }));

        saveSession(normalizeTokenPayload(tokenPayload));
        pendingAuth = null;
        return sendRedirect(response, "/overview.html?connected=1");
    } catch (error) {
        pendingAuth = null;
        return sendRedirect(response, `/overview.html?error=${encodeURIComponent(error.message)}`);
    }
}

async function handleStatus(response) {
    if (!isConfigured()) {
        return sendJson(response, 200, {
            connected: false,
            configurationMissing: true,
            profile: null,
            updatedAt: null
        });
    }

    if (!tokenState) {
        return sendJson(response, 200, {
            connected: false,
            configurationMissing: false,
            profile: null,
            updatedAt: null
        });
    }

    try {
        const profile = await soundCloudRequest("/me");
        return sendJson(response, 200, {
            connected: true,
            configurationMissing: false,
            profile: summarizeProfile(profile),
            updatedAt: tokenState.updatedAt
        });
    } catch (error) {
        clearSession();
        return sendJson(response, 200, {
            connected: false,
            configurationMissing: false,
            profile: null,
            updatedAt: null,
            error: error.message
        });
    }
}

async function handleMe(response) {
    if (!isConfigured()) {
        return sendJson(response, 503, { message: "SoundCloud keys are missing." });
    }

    if (!tokenState) {
        return sendJson(response, 401, { message: "SoundCloud is not connected." });
    }

    const profile = await soundCloudRequest("/me");
    return sendJson(response, 200, summarizeProfile(profile));
}

async function handleTracks(response) {
    if (!isConfigured()) {
        return sendJson(response, 503, { message: "SoundCloud keys are missing." });
    }

    if (!tokenState) {
        return sendJson(response, 401, { message: "SoundCloud is not connected." });
    }

    const collection = await fetchAllTracks();
    return sendJson(response, 200, {
        collection,
        fetchedAt: new Date().toISOString()
    });
}

async function soundCloudRequest(resourceUrl) {
    const accessToken = await ensureAccessToken();
    if (!accessToken) {
        throw new Error("SoundCloud is not connected.");
    }

    const url = resourceUrl.startsWith("http") ? resourceUrl : `https://api.soundcloud.com${resourceUrl}`;
    const result = await fetch(url, {
        headers: {
            Accept: "application/json; charset=utf-8",
            Authorization: `OAuth ${accessToken}`
        }
    });

    if (!result.ok) {
        let message = `${result.status} ${result.statusText}`;
        try {
            const payload = await result.json();
            message = payload.message || payload.error || message;
        } catch (error) {
            message = `${result.status} ${result.statusText}`;
        }

        if (result.status === 401) {
            clearSession();
        }
        throw new Error(message);
    }

    return result.json();
}

async function ensureAccessToken() {
    if (!tokenState) {
        return null;
    }

    if (tokenState.expiresAt && Date.now() < tokenState.expiresAt - 60_000) {
        return tokenState.accessToken;
    }

    if (!tokenState.refreshToken) {
        clearSession();
        return null;
    }

    const refreshed = await requestToken(new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
        refresh_token: tokenState.refreshToken
    }));
    saveSession(normalizeTokenPayload(refreshed));
    return tokenState.accessToken;
}

async function requestToken(body) {
    const result = await fetch("https://secure.soundcloud.com/oauth/token", {
        method: "POST",
        headers: {
            Accept: "application/json; charset=utf-8",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    });

    const payload = await result.json();
    if (!result.ok) {
        throw new Error(payload.message || payload.error || "Unable to complete the SoundCloud OAuth flow.");
    }

    return payload;
}

function normalizeTokenPayload(payload) {
    return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: Date.now() + ((payload.expires_in || 3600) * 1000),
        updatedAt: new Date().toISOString()
    };
}

async function fetchAllTracks() {
    let nextHref = "https://api.soundcloud.com/me/tracks?limit=200&linked_partitioning=true";
    const collection = [];
    const visited = new Set();

    while (nextHref) {
        if (visited.has(nextHref) || visited.size > 25) {
            break;
        }

        visited.add(nextHref);
        const payload = await soundCloudRequest(nextHref);
        const tracks = Array.isArray(payload.collection) ? payload.collection : [];
        collection.push(...tracks);
        nextHref = payload.next_href || "";
    }

    return collection;
}

function summarizeProfile(profile) {
    return {
        username: profile.username,
        permalink_url: profile.permalink_url,
        avatar_url: profile.avatar_url,
        plan: profile.plan,
        followers_count: profile.followers_count,
        track_count: profile.track_count,
        private_tracks_count: profile.private_tracks_count,
        likes_count: profile.likes_count
    };
}

function serveStatic(requestPath, response) {
    const normalizedPath = requestPath === "/" ? "/overview.html" : requestPath;
    const safePath = normalizedPath.replace(/^\/+/, "");
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
        return sendJson(response, 403, { message: "Forbidden path." });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return sendJson(response, 404, { message: "File not found." });
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const cacheControl = [".html", ".js", ".css"].includes(extension)
        ? "no-store"
        : "public, max-age=300";

    response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": cacheControl,
        "Content-Type": contentType
    });
    fs.createReadStream(filePath).pipe(response);
}

function base64UrlEncode(buffer) {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}