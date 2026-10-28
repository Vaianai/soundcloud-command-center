export const API_BASE = location.protocol === "file:" ? "http://localhost:4173" : "";

const REVENUE_STORAGE_KEY = "soundcloud-command-center-revenue-v2";
const LIVE_CACHE_KEY = "soundcloud-command-center-live-v1";
const TYPE_COLORS = {
    "Sub Stream": "#ff7a18",
    "Ad Stream": "#00d1c7"
};
const FALLBACK_COLORS = ["#ff7a18", "#00d1c7", "#ff4d8d", "#4ade80", "#60a5fa", "#facc15"];

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1 });
const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

export function initializePageShell() {
    applyRevealDelays();

    const currentPage = document.body.dataset.page;
    document.querySelectorAll("[data-nav]").forEach((link) => {
        link.classList.toggle("active", link.dataset.nav === currentPage);
    });

    const connectButton = document.getElementById("connectButton");
    if (connectButton) {
        connectButton.href = `${getServerOrigin()}/auth/login`;
    }

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            try {
                await fetchJson("/auth/logout", { method: "POST" });
                clearLiveCache();
                showToast("Disconnected from SoundCloud.");
                window.location.reload();
            } catch (error) {
                showToast(error.message || "Unable to disconnect right now.");
            }
        });
    }
}

export function renderGlobalConnection(status, fallbackLabel) {
    const globalStatusPill = document.getElementById("globalStatusPill");
    const connectButton = document.getElementById("connectButton");
    const logoutButton = document.getElementById("logoutButton");

    if (status.connected) {
        if (globalStatusPill) {
            globalStatusPill.textContent = `${status.profile?.username || "SoundCloud"} live`;
        }
        if (connectButton) {
            connectButton.hidden = true;
        }
        if (logoutButton) {
            logoutButton.hidden = false;
        }
        return;
    }

    if (connectButton) {
        connectButton.hidden = false;
    }
    if (logoutButton) {
        logoutButton.hidden = true;
    }

    if (!globalStatusPill) {
        return;
    }

    if (!status.serverReachable) {
        globalStatusPill.textContent = "Server offline";
        return;
    }

    if (status.configurationMissing) {
        globalStatusPill.textContent = "Add app keys";
        return;
    }

    globalStatusPill.textContent = fallbackLabel;
}

export function applyRevealDelays(root = document) {
    root.querySelectorAll(".reveal").forEach((element, index) => {
        element.style.setProperty("--delay", `${index * 80}ms`);
    });
}

export function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
        toast.classList.remove("visible");
    }, 3400);
}

export async function fetchJson(path, options = {}) {
    const url = path.startsWith("http") ? path : `${getServerOrigin()}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.headers || {})
        }
    });

    if (response.status === 204) {
        return null;
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        payload = null;
    }

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `${response.status} ${response.statusText}`);
    }

    return payload;
}

export async function getAuthStatus() {
    try {
        const status = await fetchJson("/auth/status");
        return {
            connected: Boolean(status.connected),
            serverReachable: true,
            configurationMissing: Boolean(status.configurationMissing),
            profile: status.profile || null,
            updatedAt: status.updatedAt || null,
            error: status.error || ""
        };
    } catch (error) {
        return {
            connected: false,
            serverReachable: false,
            configurationMissing: false,
            profile: null,
            updatedAt: null,
            error: error.message
        };
    }
}

export async function loadLiveDataset({ forceRefresh = false, status } = {}) {
    const authStatus = status || await getAuthStatus();
    const cached = loadLiveCache();

    if (!authStatus.connected) {
        return {
            profile: cached?.profile || null,
            tracks: Array.isArray(cached?.tracks) ? cached.tracks : [],
            updatedAt: cached?.updatedAt || null,
            connected: false,
            fromCache: Boolean(cached?.tracks?.length),
            authStatus,
            error: authStatus.error || ""
        };
    }

    try {
        const [profile, tracksResponse] = await Promise.all([
            fetchJson("/api/me"),
            fetchJson(`/api/tracks${forceRefresh ? "?refresh=1" : ""}`)
        ]);

        const payload = {
            profile,
            tracks: Array.isArray(tracksResponse?.collection) ? tracksResponse.collection : [],
            updatedAt: tracksResponse?.fetchedAt || new Date().toISOString()
        };
        saveLiveCache(payload);
        return {
            ...payload,
            connected: true,
            fromCache: false,
            authStatus
        };
    } catch (error) {
        return {
            profile: cached?.profile || null,
            tracks: Array.isArray(cached?.tracks) ? cached.tracks : [],
            updatedAt: cached?.updatedAt || null,
            connected: false,
            fromCache: Boolean(cached?.tracks?.length),
            authStatus,
            error: error.message
        };
    }
}

export function loadRevenueState() {
    try {
        const raw = window.localStorage.getItem(REVENUE_STORAGE_KEY);
        if (!raw) {
            return { statements: [] };
        }
        const parsed = JSON.parse(raw);
        return {
            statements: Array.isArray(parsed?.statements) ? parsed.statements : []
        };
    } catch (error) {
        return { statements: [] };
    }
}

export function saveRevenueState(state) {
    window.localStorage.setItem(REVENUE_STORAGE_KEY, JSON.stringify(state));
}

export function clearRevenueState(state) {
    state.statements = [];
    saveRevenueState(state);
}

export function buildStatement(file, text) {
    const sanitizedText = text.replace(/^\uFEFF/, "");
    const rows = parseCsv(sanitizedText);
    const headerIndex = rows.findIndex((row) => row.includes("Reporting Period") && row.includes("Revenue (USD)"));

    if (headerIndex === -1) {
        throw new Error("Reporting Period header was not found.");
    }

    const headers = rows[headerIndex].map((cell) => cell.trim());
    const indexMap = new Map(headers.map((header, index) => [header, index]));
    const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim() !== ""));

    const normalizedRows = dataRows
        .map((row) => normalizeRevenueRow(row, indexMap))
        .filter(Boolean);

    if (!normalizedRows.length) {
        throw new Error("No payout rows were found in this statement.");
    }

    return {
        id: hashString(sanitizedText),
        name: file.name,
        importedAt: new Date().toISOString(),
        rowCount: normalizedRows.length,
        months: unique(normalizedRows.map((row) => row.reportingPeriod)).sort(),
        accountId: extractAccountId(rows),
        rows: normalizedRows
    };
}

export function upsertStatement(state, statement) {
    const existingHashIndex = state.statements.findIndex((item) => item.id === statement.id);
    if (existingHashIndex >= 0) {
        state.statements.splice(existingHashIndex, 1, statement);
        sortStatements(state.statements);
        return `${statement.name} updated.`;
    }

    if (statement.months.length === 1) {
        const targetMonth = statement.months[0];
        const previousLength = state.statements.length;
        state.statements = state.statements.filter((item) => !(item.months.length === 1 && item.months[0] === targetMonth));
        state.statements.push(statement);
        sortStatements(state.statements);
        return state.statements.length !== previousLength ? `${statement.name} imported and replaced ${targetMonth}.` : `${statement.name} imported.`;
    }

    state.statements.push(statement);
    sortStatements(state.statements);
    return `${statement.name} imported.`;
}

export function removeStatement(state, statementId) {
    state.statements = state.statements.filter((item) => item.id !== statementId);
    sortStatements(state.statements);
    saveRevenueState(state);
}

export function buildRevenueMetrics(statements) {
    const rows = statements.flatMap((statement) => statement.rows || []);
    const monthMap = new Map();
    const trackMap = new Map();
    const countryMap = new Map();
    const typeMap = new Map();

    let totalRevenue = 0;
    let totalStreams = 0;

    rows.forEach((row) => {
        totalRevenue += row.revenue;
        totalStreams += row.units;

        if (!monthMap.has(row.reportingPeriod)) {
            monthMap.set(row.reportingPeriod, {
                month: row.reportingPeriod,
                revenue: 0,
                units: 0,
                tracks: new Set(),
                countries: new Set(),
                trackRevenue: new Map()
            });
        }

        if (!trackMap.has(row.track)) {
            trackMap.set(row.track, {
                name: row.track,
                revenue: 0,
                units: 0,
                countries: new Set(),
                months: new Set(),
                isrcs: new Set()
            });
        }

        if (!countryMap.has(row.country)) {
            countryMap.set(row.country, {
                name: row.country,
                revenue: 0,
                units: 0,
                tracks: new Set()
            });
        }

        if (!typeMap.has(row.type)) {
            typeMap.set(row.type, {
                name: row.type,
                revenue: 0,
                units: 0
            });
        }

        const monthEntry = monthMap.get(row.reportingPeriod);
        monthEntry.revenue += row.revenue;
        monthEntry.units += row.units;
        monthEntry.tracks.add(row.track);
        monthEntry.countries.add(row.country);
        monthEntry.trackRevenue.set(row.track, (monthEntry.trackRevenue.get(row.track) || 0) + row.revenue);

        const trackEntry = trackMap.get(row.track);
        trackEntry.revenue += row.revenue;
        trackEntry.units += row.units;
        trackEntry.countries.add(row.country);
        trackEntry.months.add(row.reportingPeriod);
        if (row.isrc) {
            trackEntry.isrcs.add(row.isrc);
        }

        const countryEntry = countryMap.get(row.country);
        countryEntry.revenue += row.revenue;
        countryEntry.units += row.units;
        countryEntry.tracks.add(row.track);

        const typeEntry = typeMap.get(row.type);
        typeEntry.revenue += row.revenue;
        typeEntry.units += row.units;
    });

    const monthly = Array.from(monthMap.values())
        .map((entry) => ({
            month: entry.month,
            revenue: entry.revenue,
            units: entry.units,
            rpm: calculateRpm(entry.revenue, entry.units),
            trackCount: entry.tracks.size,
            countryCount: entry.countries.size,
            topTrack: getTopMapKey(entry.trackRevenue)
        }))
        .sort((left, right) => left.month.localeCompare(right.month));

    const tracks = Array.from(trackMap.values())
        .map((entry) => {
            const exactKey = normalizeTrackName(entry.name);
            return {
                name: entry.name,
                revenue: entry.revenue,
                units: entry.units,
                rpm: calculateRpm(entry.revenue, entry.units),
                countryCount: entry.countries.size,
                monthCount: entry.months.size,
                revenueShare: totalRevenue ? entry.revenue / totalRevenue : 0,
                isrcs: Array.from(entry.isrcs),
                exactKey,
                variants: buildTitleVariants(entry.name)
            };
        })
        .sort((left, right) => right.revenue - left.revenue);

    const countries = Array.from(countryMap.values())
        .map((entry) => ({
            name: entry.name,
            revenue: entry.revenue,
            units: entry.units,
            trackCount: entry.tracks.size,
            revenueShare: totalRevenue ? entry.revenue / totalRevenue : 0
        }))
        .sort((left, right) => right.revenue - left.revenue);

    const types = Array.from(typeMap.values())
        .map((entry) => ({
            name: entry.name,
            revenue: entry.revenue,
            units: entry.units,
            share: totalRevenue ? entry.revenue / totalRevenue : 0,
            color: TYPE_COLORS[entry.name] || fallbackColor(entry.name)
        }))
        .sort((left, right) => right.revenue - left.revenue);

    const bestMonth = monthly.reduce((best, current) => (current.revenue > (best?.revenue || 0) ? current : best), null);
    const bestTrack = tracks[0] || null;
    const topCountry = countries[0] || null;
    const subscriberType = types.find((entry) => entry.name === "Sub Stream");
    const lastMonth = monthly[monthly.length - 1] || null;
    const previousMonth = monthly[monthly.length - 2] || null;
    const topThreeRevenue = tracks.slice(0, 3).reduce((sum, item) => sum + item.revenue, 0);

    return {
        statements,
        rows,
        statementCount: statements.length,
        monthly,
        tracks,
        countries,
        types,
        totalRevenue,
        totalStreams,
        averageRpm: calculateRpm(totalRevenue, totalStreams),
        activeTracks: tracks.length,
        activeCountries: countries.length,
        bestMonth,
        bestTrack,
        topCountry,
        topThreeShare: totalRevenue ? topThreeRevenue / totalRevenue : 0,
        subShare: subscriberType ? subscriberType.share : 0,
        subRevenue: subscriberType ? subscriberType.revenue : 0,
        lastMonth,
        previousMonth,
        loadedMonths: monthly.length,
        loadedRows: rows.length
    };
}

export function mergeTracksWithRevenue(liveTracks, revenueMetrics) {
    const lookup = buildRevenueLookup(revenueMetrics.tracks);

    return liveTracks
        .map((track) => {
            const match = findRevenueMatch(track, lookup);
            const plays = toNumber(track.playback_count);
            const likes = toNumber(track.favoritings_count ?? track.likes_count);
            const comments = toNumber(track.comment_count);
            const reposts = toNumber(track.reposts_count);
            const engagement = likes + comments + reposts;
            const revenueTrack = match?.track || null;

            return {
                ...track,
                plays,
                likes,
                comments,
                reposts,
                engagement,
                engagementRate: plays ? engagement / plays : 0,
                reportedRevenue: revenueTrack?.revenue || 0,
                reportedStreams: revenueTrack?.units || 0,
                reportedRpm: revenueTrack?.rpm || 0,
                revenueCountries: revenueTrack?.countryCount || 0,
                revenueMonths: revenueTrack?.monthCount || 0,
                isMonetized: Boolean(revenueTrack),
                matchConfidence: match?.confidence || "none",
                revealStats: track.reveal_stats !== false,
                durationMs: toNumber(track.duration),
                createdTimestamp: Date.parse(track.created_at || "") || 0,
                normalizedTitle: normalizeTrackName(track.title || "")
            };
        })
        .sort((left, right) => right.plays - left.plays);
}

export function buildCatalogMetrics(profile, liveTracks, revenueMetrics) {
    const mergedTracks = mergeTracksWithRevenue(liveTracks, revenueMetrics);
    const totalTracks = mergedTracks.length;
    const totalPlays = mergedTracks.reduce((sum, track) => sum + track.plays, 0);
    const totalEngagement = mergedTracks.reduce((sum, track) => sum + track.engagement, 0);
    const monetizedTracks = mergedTracks.filter((track) => track.isMonetized);
    const hiddenTracks = mergedTracks.filter((track) => !track.revealStats);
    const publicTracks = mergedTracks.filter((track) => track.sharing !== "private");
    const privateTracks = mergedTracks.filter((track) => track.sharing === "private");
    const topPlayed = mergedTracks[0] || null;
    const topRevenueTrack = monetizedTracks.slice().sort((left, right) => right.reportedRevenue - left.reportedRevenue)[0] || null;
    const topUnmonetized = mergedTracks.filter((track) => !track.isMonetized).sort((left, right) => right.plays - left.plays)[0] || null;
    const oldestEarner = monetizedTracks.filter((track) => track.createdTimestamp).sort((left, right) => left.createdTimestamp - right.createdTimestamp)[0] || null;
    const playsOnMonetized = monetizedTracks.reduce((sum, track) => sum + track.plays, 0);
    const publicMonetized = mergedTracks.filter((track) => track.sharing !== "private" && track.isMonetized).length;
    const publicUnmonetized = mergedTracks.filter((track) => track.sharing !== "private" && !track.isMonetized).length;
    const privateMonetized = mergedTracks.filter((track) => track.sharing === "private" && track.isMonetized).length;
    const privateUnmonetized = mergedTracks.filter((track) => track.sharing === "private" && !track.isMonetized).length;

    return {
        profile,
        mergedTracks,
        totalTracks,
        totalPlays,
        totalEngagement,
        averagePlays: totalTracks ? totalPlays / totalTracks : 0,
        averageEngagementRate: totalPlays ? totalEngagement / totalPlays : 0,
        monetizedCount: monetizedTracks.length,
        monetizedShare: totalTracks ? monetizedTracks.length / totalTracks : 0,
        playsOnMonetized,
        playsOnMonetizedShare: totalPlays ? playsOnMonetized / totalPlays : 0,
        hiddenStatsCount: hiddenTracks.length,
        hiddenStatsShare: totalTracks ? hiddenTracks.length / totalTracks : 0,
        publicCount: publicTracks.length,
        publicShare: totalTracks ? publicTracks.length / totalTracks : 0,
        privateCount: privateTracks.length,
        topPlayed,
        topRevenueTrack,
        topUnmonetized,
        oldestEarner,
        splitCounts: {
            publicMonetized,
            publicUnmonetized,
            privateMonetized,
            privateUnmonetized
        }
    };
}

export function bindDropzone({ input, dropzone, onFiles }) {
    if (!input || !dropzone) {
        return;
    }

    input.addEventListener("change", async (event) => {
        await onFiles(event.target.files);
        event.target.value = "";
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.add("drag-active");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropzone.classList.remove("drag-active");
        });
    });

    dropzone.addEventListener("drop", async (event) => {
        await onFiles(event.dataTransfer.files);
    });
}

export function renderEmptyState(container, message) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function renderLineChart(container, items, options = {}) {
    const {
        valueAccessor = (item) => item.value,
        labelAccessor = (item) => item.label,
        emptyMessage = "No data yet.",
        ariaLabel = "Line chart",
        yFormatter = shortCurrency,
        caption = []
    } = options;

    if (!items.length) {
        renderEmptyState(container, emptyMessage);
        return;
    }

    const width = 920;
    const height = 320;
    const padding = { top: 20, right: 18, bottom: 46, left: 36 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(...items.map((item) => valueAccessor(item)), 1);
    const gridLines = 4;

    const points = items.map((item, index) => {
        const x = items.length === 1
            ? padding.left + chartWidth / 2
            : padding.left + (chartWidth / (items.length - 1)) * index;
        const y = padding.top + chartHeight - (valueAccessor(item) / maxValue) * chartHeight;
        return { item, x, y };
    });

    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)},${(padding.top + chartHeight).toFixed(2)} L ${points[0].x.toFixed(2)},${(padding.top + chartHeight).toFixed(2)} Z`;

    const gridMarkup = Array.from({ length: gridLines + 1 }, (_, index) => {
        const y = padding.top + (chartHeight / gridLines) * index;
        const value = maxValue - (maxValue / gridLines) * index;
        return `
            <line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"></line>
            <text x="0" y="${(y + 4).toFixed(2)}" fill="#9fa9bf" font-size="12">${escapeHtml(yFormatter(value))}</text>
        `;
    }).join("");

    const labelMarkup = points.map((point) => `
        <text x="${point.x.toFixed(2)}" y="${height - 16}" text-anchor="middle" fill="#9fa9bf" font-size="12">${escapeHtml(trimText(labelAccessor(point.item), 9))}</text>
    `).join("");

    const pointMarkup = points.map((point) => `
        <g>
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="6" fill="#090b11"></circle>
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" fill="#ff7a18"></circle>
        </g>
    `).join("");

    const captionMarkup = caption.length
        ? `<div class="chart-caption">${caption.map((item) => `<span class="chart-chip"><span class="chart-chip-dot"></span>${escapeHtml(item)}</span>`).join("")}</div>`
        : "";

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">
            <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(255,122,24,0.34)"></stop>
                    <stop offset="100%" stop-color="rgba(255,122,24,0.02)"></stop>
                </linearGradient>
                <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#ff7a18"></stop>
                    <stop offset="100%" stop-color="#00d1c7"></stop>
                </linearGradient>
            </defs>
            ${gridMarkup}
            <path d="${areaPath}" fill="url(#trendFill)"></path>
            <path d="${linePath}" fill="none" stroke="url(#trendStroke)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
            ${pointMarkup}
            ${labelMarkup}
        </svg>
        ${captionMarkup}
    `;
}

export function renderDonutChart(container, legendContainer, items, options = {}) {
    const {
        emptyMessage = "No data yet.",
        centerPrimary = "0",
        centerSecondary = "No data",
        valueFormatter = (value) => formatNumber(value),
        shareFormatter = formatPercent
    } = options;

    const filtered = items.filter((item) => item.value > 0);
    if (!filtered.length) {
        container.innerHTML = "";
        container.style.background = "conic-gradient(rgba(255,255,255,0.08) 0deg 360deg)";
        legendContainer.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
        return;
    }

    const total = filtered.reduce((sum, item) => sum + item.value, 0);
    let angle = 0;
    const segments = filtered.map((item) => {
        const start = angle;
        angle += (item.value / total) * 360;
        return `${item.color} ${start.toFixed(2)}deg ${angle.toFixed(2)}deg`;
    });

    container.style.background = `conic-gradient(${segments.join(", ")})`;
    container.innerHTML = `
        <div class="donut-center">
            <div>
                <strong>${escapeHtml(centerPrimary)}</strong>
                <span>${escapeHtml(centerSecondary)}</span>
            </div>
        </div>
    `;

    legendContainer.innerHTML = filtered.map((item) => `
        <div class="legend-row">
            <span class="legend-swatch" style="background:${item.color}"></span>
            <div>
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.meta || valueFormatter(item.value))}</span>
            </div>
            <div>${escapeHtml(shareFormatter(total ? item.value / total : 0))}</div>
        </div>
    `).join("");
}

export function renderRankList(container, items, options = {}) {
    const {
        emptyMessage = "No data yet.",
        titleAccessor = (item) => item.title,
        valueAccessor = (item) => item.value,
        mainValueFormatter = (value) => formatNumber(value),
        detailFormatter = () => "",
        secondaryFormatter = () => ""
    } = options;

    if (!items.length) {
        renderEmptyState(container, emptyMessage);
        return;
    }

    const maxValue = Math.max(...items.map((item) => valueAccessor(item)), 1);
    container.innerHTML = items.map((item) => `
        <article class="rank-card">
            <div class="rank-head">
                <strong>${escapeHtml(trimText(titleAccessor(item), 44))}</strong>
                <span>${escapeHtml(mainValueFormatter(valueAccessor(item)))}</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${((valueAccessor(item) / maxValue) * 100).toFixed(2)}%"></div></div>
            <div class="rank-meta">
                <span>${escapeHtml(detailFormatter(item))}</span>
                <span>${escapeHtml(secondaryFormatter(item))}</span>
            </div>
        </article>
    `).join("");
}

export function renderTableEmpty(tbody, colspan, message) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

export function formatCurrency(value) {
    return CURRENCY_FORMATTER.format(value || 0);
}

export function formatNumber(value) {
    return NUMBER_FORMATTER.format(value || 0);
}

export function formatCompactNumber(value) {
    return COMPACT_NUMBER_FORMATTER.format(value || 0);
}

export function formatPercent(value) {
    return PERCENT_FORMATTER.format(value || 0);
}

export function formatMonth(monthKey) {
    if (!monthKey) {
        return "N/A";
    }

    const [year, month] = String(monthKey).split("-").map((value) => Number.parseInt(value, 10));
    if (!year || !month) {
        return String(monthKey);
    }

    return MONTH_FORMATTER.format(new Date(year, month - 1, 1));
}

export function formatDate(value) {
    if (!value) {
        return "N/A";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "N/A" : DATE_FORMATTER.format(date);
}

export function formatDateTime(value) {
    if (!value) {
        return "Never";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Never" : DATE_TIME_FORMATTER.format(date);
}

export function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function shortCurrency(value) {
    if (value >= 1000) {
        return `$${(value / 1000).toFixed(1)}k`;
    }
    return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

export function trimText(value, maxLength) {
    if (!value) {
        return "";
    }
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getServerOrigin() {
    return API_BASE || window.location.origin;
}

function loadLiveCache() {
    try {
        const raw = window.localStorage.getItem(LIVE_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveLiveCache(payload) {
    window.localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(payload));
}

function clearLiveCache() {
    window.localStorage.removeItem(LIVE_CACHE_KEY);
}

function normalizeRevenueRow(row, indexMap) {
    const reportingPeriod = readCell(row, indexMap, "Reporting Period");
    const units = toNumber(readCell(row, indexMap, "Units"));
    const revenue = toNumber(readCell(row, indexMap, "Revenue (USD)"));

    if (!reportingPeriod || (!units && !revenue)) {
        return null;
    }

    return {
        reportingPeriod,
        accountingPeriod: readCell(row, indexMap, "Accounting Period"),
        artist: readCell(row, indexMap, "Artist(s)"),
        release: readCell(row, indexMap, "Release"),
        track: readCell(row, indexMap, "Track") || readCell(row, indexMap, "Release") || readCell(row, indexMap, "ISRC") || "Untitled track",
        upc: readCell(row, indexMap, "UPC"),
        isrc: readCell(row, indexMap, "ISRC"),
        partner: readCell(row, indexMap, "Partner"),
        country: readCell(row, indexMap, "Country") || "N/A",
        type: readCell(row, indexMap, "Type") || "Other",
        units,
        revenue,
        revenueShare: toNumber(readCell(row, indexMap, "Revenue Share (%)")),
        splitPayShare: toNumber(readCell(row, indexMap, "Split Pay Share (%)"))
    };
}

function readCell(row, indexMap, header) {
    const index = indexMap.get(header);
    return typeof index === "number" ? String(row[index] || "").trim() : "";
}

function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentField = "";
    let insideQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const nextCharacter = text[index + 1];

        if (character === '"') {
            if (insideQuotes && nextCharacter === '"') {
                currentField += '"';
                index += 1;
            } else {
                insideQuotes = !insideQuotes;
            }
            continue;
        }

        if (character === "," && !insideQuotes) {
            currentRow.push(currentField);
            currentField = "";
            continue;
        }

        if ((character === "\n" || character === "\r") && !insideQuotes) {
            if (character === "\r" && nextCharacter === "\n") {
                index += 1;
            }
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = "";
            continue;
        }

        currentField += character;
    }

    if (currentField !== "" || currentRow.length) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

function extractAccountId(rows) {
    const accountIndex = rows.findIndex((row) => row[0] && row[0].trim() === "Account ID");
    if (accountIndex >= 0 && rows[accountIndex + 1] && rows[accountIndex + 1][0]) {
        return rows[accountIndex + 1][0].trim();
    }
    return "";
}

function sortStatements(statements) {
    statements.sort((left, right) => {
        const leftKey = left.months[left.months.length - 1] || left.importedAt;
        const rightKey = right.months[right.months.length - 1] || right.importedAt;
        return rightKey.localeCompare(leftKey);
    });
}

function buildRevenueLookup(revenueTracks) {
    const byIsrc = new Map();
    const byExactTitle = new Map();
    const byVariantTitle = new Map();

    revenueTracks.forEach((track) => {
        track.isrcs.forEach((isrc) => {
            if (isrc) {
                byIsrc.set(isrc, track);
            }
        });

        if (track.exactKey) {
            byExactTitle.set(track.exactKey, track);
        }

        track.variants.forEach((variant) => {
            if (variant && !byVariantTitle.has(variant)) {
                byVariantTitle.set(variant, track);
            }
        });
    });

    return { byIsrc, byExactTitle, byVariantTitle };
}

function findRevenueMatch(track, lookup) {
    const isrc = String(track.isrc || "").trim();
    if (isrc && lookup.byIsrc.has(isrc)) {
        return { track: lookup.byIsrc.get(isrc), confidence: "ISRC" };
    }

    const exactKey = normalizeTrackName(track.title || "");
    if (exactKey && lookup.byExactTitle.has(exactKey)) {
        return { track: lookup.byExactTitle.get(exactKey), confidence: "Exact title" };
    }

    const variants = buildTitleVariants(track.title || "");
    for (const variant of variants) {
        if (lookup.byVariantTitle.has(variant)) {
            return { track: lookup.byVariantTitle.get(variant), confidence: "Variant title" };
        }
    }

    return null;
}

function buildTitleVariants(title) {
    const raw = String(title || "").trim();
    const withoutBrackets = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    const variants = [raw, withoutBrackets];

    if (raw.includes(" - ")) {
        variants.push(raw.split(" - ")[0]);
    }
    if (withoutBrackets.includes(" - ")) {
        variants.push(withoutBrackets.split(" - ")[0]);
    }

    return unique(variants.map((value) => normalizeTrackName(value)).filter(Boolean));
}

function normalizeTrackName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function calculateRpm(revenue, units) {
    return units ? (revenue / units) * 1000 : 0;
}

function getTopMapKey(valueMap) {
    let topKey = "";
    let topValue = -Infinity;
    valueMap.forEach((value, key) => {
        if (value > topValue) {
            topValue = value;
            topKey = key;
        }
    });
    return topKey;
}

function unique(values) {
    return Array.from(new Set(values));
}

function toNumber(value) {
    const parsed = Number.parseFloat(String(value || "0").replace(/\s/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function fallbackColor(seed) {
    const hash = Array.from(String(seed || "")).reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function hashString(input) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(index);
        hash |= 0;
    }
    return `statement-${Math.abs(hash)}`;
}