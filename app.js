const STORAGE_KEY = "soundcloud-earnings-dashboard-v1";
const MONTH_FORMATTER = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric" });
const DATE_FORMATTER = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
const TYPE_COLORS = {
    "Sub Stream": "#0f9d8a",
    "Ad Stream": "#ef7f45"
};

const state = loadState();
const ui = {};

document.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    applyRevealDelays();
    bindEvents();
    renderDashboard();
});

function cacheDom() {
    ui.fileInput = document.getElementById("fileInput");
    ui.filePickerButton = document.getElementById("filePickerButton");
    ui.clearDataButton = document.getElementById("clearDataButton");
    ui.dropzone = document.getElementById("dropzone");
    ui.statementList = document.getElementById("statementList");
    ui.storageState = document.getElementById("storageState");
    ui.toast = document.getElementById("toast");

    ui.loadedStatementsPill = document.getElementById("loadedStatementsPill");
    ui.loadedMonthsPill = document.getElementById("loadedMonthsPill");
    ui.loadedRowsPill = document.getElementById("loadedRowsPill");

    ui.bestMonthValue = document.getElementById("bestMonthValue");
    ui.bestMonthLabel = document.getElementById("bestMonthLabel");
    ui.bestTrackValue = document.getElementById("bestTrackValue");
    ui.bestTrackLabel = document.getElementById("bestTrackLabel");
    ui.topShareValue = document.getElementById("topShareValue");
    ui.topShareLabel = document.getElementById("topShareLabel");

    ui.totalRevenue = document.getElementById("totalRevenue");
    ui.revenueMeta = document.getElementById("revenueMeta");
    ui.totalStreams = document.getElementById("totalStreams");
    ui.streamsMeta = document.getElementById("streamsMeta");
    ui.averageRpm = document.getElementById("averageRpm");
    ui.rpmMeta = document.getElementById("rpmMeta");
    ui.activeTracks = document.getElementById("activeTracks");
    ui.tracksMeta = document.getElementById("tracksMeta");
    ui.topCountry = document.getElementById("topCountry");
    ui.countryMeta = document.getElementById("countryMeta");
    ui.subShare = document.getElementById("subShare");
    ui.subShareMeta = document.getElementById("subShareMeta");

    ui.monthlyTrend = document.getElementById("monthlyTrend");
    ui.typeDonut = document.getElementById("typeDonut");
    ui.typeLegend = document.getElementById("typeLegend");
    ui.trackBars = document.getElementById("trackBars");
    ui.countryBars = document.getElementById("countryBars");
    ui.monthlyTableBody = document.querySelector("#monthlyTable tbody");
    ui.trackTableBody = document.querySelector("#trackTable tbody");
}

function applyRevealDelays() {
    document.querySelectorAll(".reveal").forEach((element, index) => {
        element.style.setProperty("--delay", `${index * 80}ms`);
    });
}

function bindEvents() {
    ui.filePickerButton.addEventListener("click", () => ui.fileInput.click());
    ui.fileInput.addEventListener("change", async (event) => {
        await handleFiles(event.target.files);
        event.target.value = "";
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        ui.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            ui.dropzone.classList.add("drag-active");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        ui.dropzone.addEventListener(eventName, (event) => {
            event.preventDefault();
            ui.dropzone.classList.remove("drag-active");
        });
    });

    ui.dropzone.addEventListener("drop", async (event) => {
        await handleFiles(event.dataTransfer.files);
    });

    ui.clearDataButton.addEventListener("click", () => {
        if (!state.statements.length) {
            showToast("L'archivio e gia vuoto.");
            return;
        }

        const confirmed = window.confirm("Vuoi eliminare tutti gli statement salvati in locale?");
        if (!confirmed) {
            return;
        }

        state.statements = [];
        saveState();
        renderDashboard();
        showToast("Archivio locale svuotato.");
    });

    ui.statementList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-remove-id]");
        if (!button) {
            return;
        }

        removeStatement(button.dataset.removeId);
    });
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".csv"));

    if (!files.length) {
        showToast("Nessun CSV valido selezionato.");
        return;
    }

    const importMessages = [];

    for (const file of files) {
        try {
            const text = await file.text();
            const statement = buildStatement(file, text);
            importMessages.push(upsertStatement(statement));
        } catch (error) {
            importMessages.push(`Errore su ${file.name}: ${error.message}`);
        }
    }

    saveState();
    renderDashboard();
    showToast(importMessages.join(" "));
}

function buildStatement(file, text) {
    const sanitizedText = text.replace(/^\uFEFF/, "");
    const rows = parseCsv(sanitizedText);
    const headerIndex = rows.findIndex((row) => row.includes("Reporting Period") && row.includes("Revenue (USD)"));

    if (headerIndex === -1) {
        throw new Error("intestazione non trovata. Mi aspettavo la riga con Reporting Period.");
    }

    const headers = rows[headerIndex].map((cell) => cell.trim());
    const indexMap = new Map(headers.map((header, index) => [header, index]));
    const dataRows = rows.slice(headerIndex + 1).filter((row) => row.some((cell) => cell.trim() !== ""));

    const normalizedRows = dataRows
        .map((row) => normalizeRow(row, indexMap))
        .filter(Boolean);

    if (!normalizedRows.length) {
        throw new Error("nessuna riga dati trovata nello statement.");
    }

    const months = unique(normalizedRows.map((row) => row.reportingPeriod)).sort();
    const accountId = extractAccountId(rows);
    const signature = hashString(sanitizedText);

    return {
        id: signature,
        name: file.name,
        importedAt: new Date().toISOString(),
        rowCount: normalizedRows.length,
        months,
        accountId,
        rows: normalizedRows
    };
}

function normalizeRow(row, indexMap) {
    const reportingPeriod = readCell(row, indexMap, "Reporting Period");
    const accountingPeriod = readCell(row, indexMap, "Accounting Period");
    const trackName = readCell(row, indexMap, "Track") || readCell(row, indexMap, "Release") || readCell(row, indexMap, "ISRC") || "Track senza nome";
    const country = readCell(row, indexMap, "Country") || "N/A";
    const type = readCell(row, indexMap, "Type") || "Other";
    const units = toNumber(readCell(row, indexMap, "Units"));
    const revenue = toNumber(readCell(row, indexMap, "Revenue (USD)"));

    if (!reportingPeriod || (!units && !revenue)) {
        return null;
    }

    return {
        reportingPeriod,
        accountingPeriod,
        artist: readCell(row, indexMap, "Artist(s)"),
        release: readCell(row, indexMap, "Release"),
        track: trackName,
        upc: readCell(row, indexMap, "UPC"),
        isrc: readCell(row, indexMap, "ISRC"),
        partner: readCell(row, indexMap, "Partner"),
        country,
        type,
        units,
        revenue,
        revenueShare: toNumber(readCell(row, indexMap, "Revenue Share (%)")),
        splitPayShare: toNumber(readCell(row, indexMap, "Split Pay Share (%)"))
    };
}

function readCell(row, indexMap, header) {
    const index = indexMap.get(header);
    if (typeof index !== "number") {
        return "";
    }

    return (row[index] || "").trim();
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
    const accountLabelIndex = rows.findIndex((row) => row[0] && row[0].trim() === "Account ID");
    if (accountLabelIndex >= 0 && rows[accountLabelIndex + 1] && rows[accountLabelIndex + 1][0]) {
        return rows[accountLabelIndex + 1][0].trim();
    }

    return "";
}

function upsertStatement(statement) {
    const existingHashIndex = state.statements.findIndex((item) => item.id === statement.id);
    if (existingHashIndex >= 0) {
        state.statements.splice(existingHashIndex, 1, statement);
        return `${statement.name} aggiornato.`;
    }

    if (statement.months.length === 1) {
        const targetMonth = statement.months[0];
        const previousCount = state.statements.length;
        state.statements = state.statements.filter((item) => !(item.months.length === 1 && item.months[0] === targetMonth));

        if (state.statements.length !== previousCount) {
            state.statements.push(statement);
            sortStatements();
            return `${statement.name} importato e mese ${targetMonth} sostituito.`;
        }
    }

    state.statements.push(statement);
    sortStatements();
    return `${statement.name} importato con successo.`;
}

function removeStatement(statementId) {
    const nextStatements = state.statements.filter((statement) => statement.id !== statementId);
    if (nextStatements.length === state.statements.length) {
        return;
    }

    state.statements = nextStatements;
    saveState();
    renderDashboard();
    showToast("Statement rimosso dall'archivio locale.");
}

function sortStatements() {
    state.statements.sort((left, right) => {
        const leftKey = left.months[left.months.length - 1] || left.importedAt;
        const rightKey = right.months[right.months.length - 1] || right.importedAt;
        return rightKey.localeCompare(leftKey);
    });
}

function renderDashboard() {
    const rows = state.statements.flatMap((statement) => statement.rows || []);
    const metrics = buildMetrics(rows);

    renderArchive(metrics);
    renderHighlights(metrics);
    renderKpis(metrics);
    renderStatementList();
    renderMonthlyTrend(metrics);
    renderTypeMix(metrics);
    renderTopBars(ui.trackBars, metrics.tracks.slice(0, 8), {
        metricFormatter: formatCurrency,
        detailBuilder: (item) => `${formatNumber(item.units)} stream · ${item.countryCount} paesi`,
        secondaryMetricBuilder: (item) => `RPM ${formatCurrency(item.rpm)}`
    });
    renderTopBars(ui.countryBars, metrics.countries.slice(0, 8), {
        metricFormatter: formatCurrency,
        detailBuilder: (item) => `${formatNumber(item.units)} stream · ${item.trackCount} track`,
        secondaryMetricBuilder: (item) => `${formatPercent(item.revenueShare)} quota`
    });
    renderMonthlyTable(metrics.monthly);
    renderTrackTable(metrics.tracks);
}

function buildMetrics(rows) {
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
                months: new Set()
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
        .map((entry) => ({
            name: entry.name,
            revenue: entry.revenue,
            units: entry.units,
            rpm: calculateRpm(entry.revenue, entry.units),
            countryCount: entry.countries.size,
            monthCount: entry.months.size,
            revenueShare: totalRevenue ? entry.revenue / totalRevenue : 0
        }))
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
    const subType = types.find((entry) => entry.name === "Sub Stream");
    const lastMonth = monthly[monthly.length - 1] || null;
    const previousMonth = monthly[monthly.length - 2] || null;
    const topThreeRevenue = tracks.slice(0, 3).reduce((sum, item) => sum + item.revenue, 0);

    return {
        rows,
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
        subShare: subType ? subType.share : 0,
        lastMonth,
        previousMonth,
        loadedMonths: monthly.length,
        loadedRows: rows.length
    };
}

function renderArchive(metrics) {
    ui.loadedStatementsPill.textContent = `${state.statements.length} statement caricati`;
    ui.loadedMonthsPill.textContent = `${metrics.loadedMonths} mesi`;
    ui.loadedRowsPill.textContent = `${formatNumber(metrics.loadedRows)} righe`;

    if (!state.statements.length) {
        ui.storageState.textContent = "Archivio vuoto";
        return;
    }

    ui.storageState.textContent = `${state.statements.length} file salvati in locale`;
}

function renderHighlights(metrics) {
    if (!metrics.rows.length) {
        ui.bestMonthValue.textContent = "$0.00";
        ui.bestMonthLabel.textContent = "Carica almeno uno statement per vedere il trend.";
        ui.bestTrackValue.textContent = "-";
        ui.bestTrackLabel.textContent = "La traccia con la revenue piu alta apparira qui.";
        ui.topShareValue.textContent = "0%";
        ui.topShareLabel.textContent = "Quota delle top 3 track sul totale.";
        return;
    }

    ui.bestMonthValue.textContent = formatCurrency(metrics.bestMonth.revenue);
    ui.bestMonthLabel.textContent = `${formatMonth(metrics.bestMonth.month)} · ${formatNumber(metrics.bestMonth.units)} stream`;
    ui.bestTrackValue.textContent = trimLabel(metrics.bestTrack.name, 28);
    ui.bestTrackLabel.textContent = `${formatCurrency(metrics.bestTrack.revenue)} · ${formatNumber(metrics.bestTrack.units)} stream`;
    ui.topShareValue.textContent = formatPercent(metrics.topThreeShare);
    ui.topShareLabel.textContent = "Le prime 3 track concentrano questa quota della revenue totale.";
}

function renderKpis(metrics) {
    ui.totalRevenue.textContent = formatCurrency(metrics.totalRevenue);
    ui.totalStreams.textContent = formatNumber(metrics.totalStreams);
    ui.averageRpm.textContent = formatCurrency(metrics.averageRpm);
    ui.activeTracks.textContent = formatNumber(metrics.activeTracks);
    ui.topCountry.textContent = metrics.topCountry ? metrics.topCountry.name : "-";
    ui.subShare.textContent = formatPercent(metrics.subShare);

    if (!metrics.rows.length) {
        ui.revenueMeta.textContent = "Somma complessiva degli statement caricati.";
        ui.streamsMeta.textContent = "Conta totale delle units del catalogo importato.";
        ui.rpmMeta.textContent = "Utile per confrontare i mesi a parita di volume.";
        ui.tracksMeta.textContent = "Numero di tracce che hanno generato revenue.";
        ui.countryMeta.textContent = "Mercato con la revenue piu alta.";
        ui.subShareMeta.textContent = "Percentuale della revenue che arriva dagli ascolti premium.";
        return;
    }

    ui.revenueMeta.textContent = buildMonthComparison(metrics.lastMonth, metrics.previousMonth, "revenue");
    ui.streamsMeta.textContent = buildMonthComparison(metrics.lastMonth, metrics.previousMonth, "units");
    ui.rpmMeta.textContent = `Ultimo mese: ${metrics.lastMonth ? formatCurrency(metrics.lastMonth.rpm) : "$0.00"} per 1.000 stream.`;
    ui.tracksMeta.textContent = `${metrics.activeTracks} track attive distribuite su ${metrics.loadedMonths} mesi.`;
    ui.countryMeta.textContent = metrics.topCountry
        ? `${formatCurrency(metrics.topCountry.revenue)} su ${metrics.activeCountries} paesi attivi.`
        : "Mercato con la revenue piu alta.";
    ui.subShareMeta.textContent = metrics.types.length
        ? `${formatCurrency((metrics.types.find((item) => item.name === "Sub Stream") || { revenue: 0 }).revenue)} di revenue arriva dai listener premium.`
        : "Percentuale della revenue che arriva dagli ascolti premium.";
}

function renderStatementList() {
    if (!state.statements.length) {
        ui.statementList.innerHTML = `<li class="empty-state">Carica il primo statement CSV e l'archivio comparira qui con mese, righe importate e pulsante di rimozione.</li>`;
        return;
    }

    ui.statementList.innerHTML = state.statements
        .map((statement) => {
            const monthsLabel = statement.months.length > 1 ? `${statement.months.length} mesi` : formatMonth(statement.months[0]);
            const importedLabel = DATE_FORMATTER.format(new Date(statement.importedAt));
            return `
                <li class="statement-item">
                    <div>
                        <p class="statement-title">${escapeHtml(statement.name)}</p>
                        <span class="statement-meta">${escapeHtml(monthsLabel)} · ${formatNumber(statement.rowCount)} righe · importato ${escapeHtml(importedLabel)}</span>
                    </div>
                    <button class="statement-action" type="button" data-remove-id="${escapeHtml(statement.id)}">Rimuovi</button>
                </li>
            `;
        })
        .join("");
}

function renderMonthlyTrend(metrics) {
    if (!metrics.monthly.length) {
        ui.monthlyTrend.innerHTML = `<div class="empty-state">Importa almeno un CSV per generare il grafico della revenue mensile.</div>`;
        return;
    }

    const width = 900;
    const height = 320;
    const padding = { top: 20, right: 18, bottom: 48, left: 32 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxRevenue = Math.max(...metrics.monthly.map((item) => item.revenue), 1);
    const gridLines = 4;

    const points = metrics.monthly.map((item, index) => {
        const x = metrics.monthly.length === 1
            ? padding.left + chartWidth / 2
            : padding.left + (chartWidth / (metrics.monthly.length - 1)) * index;
        const y = padding.top + chartHeight - (item.revenue / maxRevenue) * chartHeight;
        return { ...item, x, y };
    });

    const linePath = points
        .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" ");
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)},${(padding.top + chartHeight).toFixed(2)} L ${points[0].x.toFixed(2)},${(padding.top + chartHeight).toFixed(2)} Z`;

    const gridMarkup = Array.from({ length: gridLines + 1 }, (_, index) => {
        const y = padding.top + (chartHeight / gridLines) * index;
        const value = maxRevenue - (maxRevenue / gridLines) * index;
        return `
            <line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${width - padding.right}" y2="${y.toFixed(2)}" stroke="rgba(23,32,51,0.08)" stroke-width="1" />
            <text x="0" y="${(y + 4).toFixed(2)}" fill="#5c6678" font-size="12">${escapeHtml(shortCurrency(value))}</text>
        `;
    }).join("");

    const labelsMarkup = points.map((point) => `
        <text x="${point.x.toFixed(2)}" y="${height - 18}" text-anchor="middle" fill="#5c6678" font-size="12">${escapeHtml(shortMonth(point.month))}</text>
    `).join("");

    const pointsMarkup = points.map((point) => `
        <g>
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="6" fill="#ffffff" />
            <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" fill="#0f9d8a" />
        </g>
    `).join("");

    const trendChange = buildTrendChange(metrics.lastMonth, metrics.previousMonth);

    ui.monthlyTrend.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico della revenue mensile">
            <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(15,157,138,0.34)" />
                    <stop offset="100%" stop-color="rgba(15,157,138,0.02)" />
                </linearGradient>
                <linearGradient id="trendStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#0f9d8a" />
                    <stop offset="100%" stop-color="#3b82f6" />
                </linearGradient>
            </defs>
            ${gridMarkup}
            <path d="${areaPath}" fill="url(#trendFill)"></path>
            <path d="${linePath}" fill="none" stroke="url(#trendStroke)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
            ${pointsMarkup}
            ${labelsMarkup}
        </svg>
        <div class="chart-caption">
            <span class="chart-chip"><span class="chart-dot"></span> Ultimo mese: ${metrics.lastMonth ? `${escapeHtml(formatMonth(metrics.lastMonth.month))} · ${escapeHtml(formatCurrency(metrics.lastMonth.revenue))}` : "$0.00"}</span>
            <span class="chart-chip">${escapeHtml(trendChange)}</span>
            <span class="chart-chip">Media mensile: ${escapeHtml(formatCurrency(metrics.monthly.reduce((sum, item) => sum + item.revenue, 0) / metrics.monthly.length))}</span>
        </div>
    `;
}

function renderTypeMix(metrics) {
    if (!metrics.types.length) {
        ui.typeDonut.innerHTML = "";
        ui.typeDonut.style.background = "conic-gradient(var(--accent-soft) 0deg 360deg)";
        ui.typeLegend.innerHTML = `<div class="empty-state">Carica dati per vedere il mix della revenue per tipo stream.</div>`;
        return;
    }

    let angle = 0;
    const gradientSegments = metrics.types.map((entry) => {
        const start = angle;
        angle += entry.share * 360;
        return `${entry.color} ${start.toFixed(2)}deg ${angle.toFixed(2)}deg`;
    });

    ui.typeDonut.style.background = `conic-gradient(${gradientSegments.join(", ")})`;
    ui.typeDonut.innerHTML = `
        <div class="donut-center">
            <div>
                <strong>${formatCurrency(metrics.totalRevenue)}</strong>
                <span>Revenue complessiva importata</span>
            </div>
        </div>
    `;

    ui.typeLegend.innerHTML = metrics.types.map((entry) => `
        <div class="legend-item">
            <span class="legend-swatch" style="background:${entry.color}"></span>
            <div>
                <div class="legend-name">${escapeHtml(entry.name)}</div>
                <div class="legend-meta">${formatNumber(entry.units)} stream</div>
            </div>
            <div class="legend-name">${formatCurrency(entry.revenue)} · ${formatPercent(entry.share)}</div>
        </div>
    `).join("");
}

function renderTopBars(container, items, options) {
    if (!items.length) {
        container.innerHTML = `<div class="empty-state">Carica dati per popolare questa classifica.</div>`;
        return;
    }

    const maxValue = Math.max(...items.map((item) => item.revenue), 1);

    container.innerHTML = items.map((item) => `
        <article class="bar-row">
            <div class="bar-row-head">
                <strong>${escapeHtml(trimLabel(item.name, 48))}</strong>
                <span>${options.metricFormatter(item.revenue)}</span>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${((item.revenue / maxValue) * 100).toFixed(2)}%"></div>
            </div>
            <div class="bar-row-meta">
                <span>${escapeHtml(options.detailBuilder(item))}</span>
                <span>${escapeHtml(options.secondaryMetricBuilder(item))}</span>
            </div>
        </article>
    `).join("");
}

function renderMonthlyTable(monthly) {
    if (!monthly.length) {
        ui.monthlyTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Nessun mese disponibile. Importa un CSV per riempire la tabella.</div></td></tr>`;
        return;
    }

    ui.monthlyTableBody.innerHTML = monthly
        .slice()
        .reverse()
        .map((item) => `
            <tr>
                <td>${escapeHtml(formatMonth(item.month))}</td>
                <td>${formatCurrency(item.revenue)}</td>
                <td>${formatNumber(item.units)}</td>
                <td>${formatCurrency(item.rpm)}</td>
                <td>${escapeHtml(trimLabel(item.topTrack || "-", 48))}</td>
            </tr>
        `)
        .join("");
}

function renderTrackTable(tracks) {
    if (!tracks.length) {
        ui.trackTableBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">La tabella del catalogo si popola dopo il primo import.</div></td></tr>`;
        return;
    }

    ui.trackTableBody.innerHTML = tracks
        .slice(0, 12)
        .map((item) => `
            <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${formatCurrency(item.revenue)}</td>
                <td>${formatNumber(item.units)}</td>
                <td>${formatCurrency(item.rpm)}</td>
                <td>${formatNumber(item.countryCount)}</td>
                <td>${formatNumber(item.monthCount)}</td>
            </tr>
        `)
        .join("");
}

function buildMonthComparison(lastMonth, previousMonth, property) {
    if (!lastMonth) {
        return "Nessun dato disponibile per il confronto mensile.";
    }

    if (!previousMonth) {
        return `Primo mese disponibile: ${formatMonth(lastMonth.month)}.`;
    }

    const difference = lastMonth[property] - previousMonth[property];
    const ratio = previousMonth[property] ? difference / previousMonth[property] : 0;
    const direction = difference >= 0 ? "su" : "giu";
    const value = property === "revenue" ? formatCurrency(Math.abs(difference)) : formatNumber(Math.abs(difference));

    return `${formatMonth(lastMonth.month)} ${direction} di ${value} (${formatPercent(Math.abs(ratio))}) vs ${formatMonth(previousMonth.month)}.`;
}

function buildTrendChange(lastMonth, previousMonth) {
    if (!lastMonth || !previousMonth) {
        return "Servono almeno due mesi per leggere la variazione.";
    }

    const difference = lastMonth.revenue - previousMonth.revenue;
    const direction = difference >= 0 ? "in crescita" : "in calo";
    return `${direction} di ${formatCurrency(Math.abs(difference))} rispetto a ${formatMonth(previousMonth.month)}`;
}

function calculateRpm(revenue, units) {
    if (!units) {
        return 0;
    }

    return (revenue / units) * 1000;
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
    return Array.from(new Set(values.filter(Boolean)));
}

function toNumber(value) {
    const normalized = Number.parseFloat(String(value || "0").replace(/\s/g, ""));
    return Number.isFinite(normalized) ? normalized : 0;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
}

function shortCurrency(value) {
    if (value >= 1000) {
        return `$${(value / 1000).toFixed(1)}k`;
    }

    return `$${value.toFixed(value >= 10 ? 0 : 2)}`;
}

function formatNumber(value) {
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatPercent(value) {
    return new Intl.NumberFormat("it-IT", {
        style: "percent",
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
    }).format(value || 0);
}

function formatMonth(monthKey) {
    if (!monthKey) {
        return "N/A";
    }

    const [year, month] = monthKey.split("-").map((value) => Number.parseInt(value, 10));
    if (!year || !month) {
        return monthKey;
    }

    return MONTH_FORMATTER.format(new Date(year, month - 1, 1));
}

function shortMonth(monthKey) {
    const formatted = formatMonth(monthKey);
    return formatted.replace(" ", "\n");
}

function trimLabel(label, maxLength) {
    if (label.length <= maxLength) {
        return label;
    }

    return `${label.slice(0, maxLength - 3)}...`;
}

function fallbackColor(seed) {
    const palette = ["#3b82f6", "#7c3aed", "#e11d48", "#14b8a6", "#f59e0b", "#0ea5e9"];
    const hash = Array.from(seed).reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return palette[hash % palette.length];
}

function hashString(input) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(index);
        hash |= 0;
    }
    return `statement-${Math.abs(hash)}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("visible");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => {
        ui.toast.classList.remove("visible");
    }, 3600);
}

function loadState() {
    try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            return { statements: [] };
        }

        const parsed = JSON.parse(saved);
        return {
            statements: Array.isArray(parsed.statements) ? parsed.statements : []
        };
    } catch (error) {
        return { statements: [] };
    }
}

function saveState() {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        showToast("Impossibile salvare l'archivio locale: spazio browser esaurito.");
    }
}