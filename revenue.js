import {
    initializePageShell,
    renderGlobalConnection,
    getAuthStatus,
    loadLiveDataset,
    loadRevenueState,
    saveRevenueState,
    clearRevenueState,
    buildStatement,
    upsertStatement,
    removeStatement,
    buildRevenueMetrics,
    buildCatalogMetrics,
    bindDropzone,
    renderLineChart,
    renderDonutChart,
    renderRankList,
    renderTableEmpty,
    formatCurrency,
    formatNumber,
    formatPercent,
    formatMonth,
    shortCurrency,
    trimText,
    escapeHtml,
    showToast
} from "./data.js";

const revenueState = loadRevenueState();

init();

async function init() {
    initializePageShell();
    bindRevenueImporter();

    const authStatus = await getAuthStatus();
    renderGlobalConnection(authStatus, "Revenue archive");

    const liveDataset = await loadLiveDataset({ status: authStatus });
    renderRevenuePage(liveDataset);
}

function bindRevenueImporter() {
    const fileInput = document.getElementById("fileInput");
    const dropzone = document.getElementById("dropzone");
    const selectFilesButton = document.getElementById("selectFilesButton");
    const clearArchiveButton = document.getElementById("clearArchiveButton");
    const statementList = document.getElementById("statementList");

    selectFilesButton.addEventListener("click", () => fileInput.click());
    clearArchiveButton.addEventListener("click", () => {
        if (!revenueState.statements.length) {
            showToast("The archive is already empty.");
            return;
        }

        if (!window.confirm("Delete every imported payout statement from this browser?")) {
            return;
        }

        clearRevenueState(revenueState);
        renderRevenuePage();
        showToast("Revenue archive cleared.");
    });

    statementList.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-remove-id]");
        if (!button) {
            return;
        }

        removeStatement(revenueState, button.dataset.removeId);
        renderRevenuePage();
        showToast("Statement removed from the local archive.");
    });

    bindDropzone({
        input: fileInput,
        dropzone,
        onFiles: importFiles
    });
}

async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.name.toLowerCase().endsWith(".csv"));
    if (!files.length) {
        showToast("No CSV files selected.");
        return;
    }

    const messages = [];
    for (const file of files) {
        try {
            const text = await file.text();
            const statement = buildStatement(file, text);
            messages.push(upsertStatement(revenueState, statement));
        } catch (error) {
            messages.push(`${file.name}: ${error.message}`);
        }
    }

    saveRevenueState(revenueState);
    renderRevenuePage();
    showToast(messages.join(" "));
}

function renderRevenuePage(liveDataset = { profile: null, tracks: [] }) {
    const revenueMetrics = buildRevenueMetrics(revenueState.statements);
    const catalogMetrics = buildCatalogMetrics(liveDataset.profile, liveDataset.tracks || [], revenueMetrics);

    document.getElementById("revenueStatementPill").textContent = `${revenueMetrics.statementCount} statement${revenueMetrics.statementCount === 1 ? "" : "s"} loaded`;
    document.getElementById("revenueMonthPill").textContent = `${revenueMetrics.loadedMonths} reporting months`;
    document.getElementById("revenueRowPill").textContent = `${formatNumber(revenueMetrics.loadedRows)} payout rows`;

    document.getElementById("bestMonthValue").textContent = revenueMetrics.bestMonth ? formatCurrency(revenueMetrics.bestMonth.revenue) : "$0.00";
    document.getElementById("bestMonthMeta").textContent = revenueMetrics.bestMonth
        ? `${formatMonth(revenueMetrics.bestMonth.month)} · ${formatNumber(revenueMetrics.bestMonth.units)} reported streams`
        : "Import a statement to reveal your strongest month.";

    document.getElementById("bestTrackValue").textContent = revenueMetrics.bestTrack ? trimText(revenueMetrics.bestTrack.name, 34) : "No data yet";
    document.getElementById("bestTrackMeta").textContent = revenueMetrics.bestTrack
        ? `${formatCurrency(revenueMetrics.bestTrack.revenue)} · ${formatNumber(revenueMetrics.bestTrack.units)} reported streams`
        : "The top earner will appear here.";

    document.getElementById("topShareValue").textContent = formatPercent(revenueMetrics.topThreeShare);
    document.getElementById("topShareMeta").textContent = revenueMetrics.tracks.length
        ? "Top 3 tracks share this slice of the full imported revenue archive."
        : "How much of total revenue comes from only three tracks.";

    document.getElementById("totalRevenueMetric").textContent = formatCurrency(revenueMetrics.totalRevenue);
    document.getElementById("totalRevenueMeta").textContent = describeMonthlyDelta(revenueMetrics, "revenue");
    document.getElementById("reportedStreamsMetric").textContent = formatNumber(revenueMetrics.totalStreams);
    document.getElementById("reportedStreamsMeta").textContent = describeMonthlyDelta(revenueMetrics, "units");
    document.getElementById("rpmMetric").textContent = formatCurrency(revenueMetrics.averageRpm);
    document.getElementById("rpmMeta").textContent = revenueMetrics.lastMonth
        ? `Last month RPM: ${formatCurrency(revenueMetrics.lastMonth.rpm)}.`
        : "A strong comparison metric across months.";
    document.getElementById("activeTracksMetric").textContent = formatNumber(revenueMetrics.activeTracks);
    document.getElementById("activeTracksMeta").textContent = `${formatNumber(revenueMetrics.activeTracks)} revenue-active tracks across ${formatNumber(revenueMetrics.loadedMonths)} months.`;
    document.getElementById("topCountryMetric").textContent = revenueMetrics.topCountry ? revenueMetrics.topCountry.name : "-";
    document.getElementById("topCountryMeta").textContent = revenueMetrics.topCountry
        ? `${formatCurrency(revenueMetrics.topCountry.revenue)} across ${formatNumber(revenueMetrics.activeCountries)} markets.`
        : "Country with the highest revenue total.";
    document.getElementById("subShareMetric").textContent = formatPercent(revenueMetrics.subShare);
    document.getElementById("subShareMeta").textContent = revenueMetrics.subRevenue
        ? `${formatCurrency(revenueMetrics.subRevenue)} comes from subscriber streams.`
        : "A direct view of premium listener contribution.";

    document.getElementById("archiveStatusTitle").textContent = revenueMetrics.statementCount
        ? `${revenueMetrics.statementCount} local statement file${revenueMetrics.statementCount === 1 ? "" : "s"}`
        : "Browser archive ready";
    document.getElementById("archiveStatusCopy").textContent = catalogMetrics.totalTracks
        ? `${formatNumber(catalogMetrics.monetizedCount)} live tracks currently match the payout archive.`
        : "No uploads to external servers. Imported payout files stay local unless you decide otherwise.";

    renderLineChart(document.getElementById("monthlyTrendChart"), revenueMetrics.monthly, {
        emptyMessage: "Import at least one statement to render the monthly trend.",
        ariaLabel: "Monthly reported revenue chart",
        valueAccessor: (item) => item.revenue,
        labelAccessor: (item) => formatMonth(item.month),
        yFormatter: shortCurrency,
        caption: buildTrendCaption(revenueMetrics)
    });

    renderDonutChart(document.getElementById("typeMixChart"), document.getElementById("typeMixLegend"), revenueMetrics.types.map((item) => ({
        label: item.name,
        value: item.revenue,
        color: item.color,
        meta: `${formatCurrency(item.revenue)} · ${formatNumber(item.units)} streams`
    })), {
        emptyMessage: "Import payout data to see the stream type split.",
        centerPrimary: formatCurrency(revenueMetrics.totalRevenue),
        centerSecondary: "reported revenue"
    });

    renderRankList(document.getElementById("trackRevenueRanks"), revenueMetrics.tracks.slice(0, 8), {
        emptyMessage: "Import payout data to populate the top earners.",
        titleAccessor: (item) => item.name,
        valueAccessor: (item) => item.revenue,
        mainValueFormatter: formatCurrency,
        detailFormatter: (item) => `${formatNumber(item.units)} streams · ${formatNumber(item.countryCount)} countries`,
        secondaryFormatter: (item) => `RPM ${formatCurrency(item.rpm)}`
    });

    renderRankList(document.getElementById("countryRevenueRanks"), revenueMetrics.countries.slice(0, 8), {
        emptyMessage: "Import payout data to populate the market ranking.",
        titleAccessor: (item) => item.name,
        valueAccessor: (item) => item.revenue,
        mainValueFormatter: formatCurrency,
        detailFormatter: (item) => `${formatNumber(item.units)} streams · ${formatNumber(item.trackCount)} tracks`,
        secondaryFormatter: (item) => `${formatPercent(item.revenueShare)} share`
    });

    renderMonthlyTable(revenueMetrics.monthly);
    renderTrackTable(revenueMetrics.tracks);
    renderStatementList(revenueState.statements);
}

function renderMonthlyTable(monthly) {
    const tbody = document.querySelector("#monthlyRevenueTable tbody");
    if (!monthly.length) {
        renderTableEmpty(tbody, 5, "No statement months yet. Import a payout CSV to fill this table.");
        return;
    }

    tbody.innerHTML = monthly.slice().reverse().map((item) => `
        <tr>
            <td>${escapeHtml(formatMonth(item.month))}</td>
            <td>${formatCurrency(item.revenue)}</td>
            <td>${formatNumber(item.units)}</td>
            <td>${formatCurrency(item.rpm)}</td>
            <td>${escapeHtml(trimText(item.topTrack || "-", 42))}</td>
        </tr>
    `).join("");
}

function renderTrackTable(tracks) {
    const tbody = document.querySelector("#trackRevenueTable tbody");
    if (!tracks.length) {
        renderTableEmpty(tbody, 6, "The track-level payout summary will appear after the first import.");
        return;
    }

    tbody.innerHTML = tracks.slice(0, 14).map((track) => `
        <tr>
            <td>${escapeHtml(trimText(track.name, 44))}</td>
            <td>${formatCurrency(track.revenue)}</td>
            <td>${formatNumber(track.units)}</td>
            <td>${formatCurrency(track.rpm)}</td>
            <td>${formatNumber(track.countryCount)}</td>
            <td>${formatNumber(track.monthCount)}</td>
        </tr>
    `).join("");
}

function renderStatementList(statements) {
    const list = document.getElementById("statementList");
    if (!statements.length) {
        list.innerHTML = `<li class="empty-state">Import your first payout CSV and the local archive will appear here.</li>`;
        return;
    }

    list.innerHTML = statements.map((statement) => {
        const monthLabel = statement.months.length === 1 ? formatMonth(statement.months[0]) : `${statement.months.length} months`;
        return `
            <li class="statement-item">
                <div>
                    <p>${escapeHtml(statement.name)}</p>
                    <span class="statement-meta">${escapeHtml(monthLabel)} · ${formatNumber(statement.rowCount)} rows</span>
                </div>
                <button class="button subtle" type="button" data-remove-id="${escapeHtml(statement.id)}">Remove</button>
            </li>
        `;
    }).join("");
}

function buildTrendCaption(metrics) {
    if (!metrics.monthly.length) {
        return [];
    }

    const lastMonth = metrics.lastMonth ? `${formatMonth(metrics.lastMonth.month)} · ${formatCurrency(metrics.lastMonth.revenue)}` : "No last month yet";
    const average = metrics.monthly.length ? formatCurrency(metrics.monthly.reduce((sum, item) => sum + item.revenue, 0) / metrics.monthly.length) : "$0.00";
    const trend = metrics.lastMonth && metrics.previousMonth
        ? `${metrics.lastMonth.revenue >= metrics.previousMonth.revenue ? "Up" : "Down"} ${formatCurrency(Math.abs(metrics.lastMonth.revenue - metrics.previousMonth.revenue))} vs ${formatMonth(metrics.previousMonth.month)}`
        : "Two months are needed for a delta";

    return [`Last month: ${lastMonth}`, trend, `Monthly average: ${average}`];
}

function describeMonthlyDelta(metrics, property) {
    if (!metrics.lastMonth) {
        return property === "revenue" ? "All imported SoundCloud statements." : "Units counted inside the imported payout archive.";
    }

    if (!metrics.previousMonth) {
        return `First reporting month available: ${formatMonth(metrics.lastMonth.month)}.`;
    }

    const difference = metrics.lastMonth[property] - metrics.previousMonth[property];
    const ratio = metrics.previousMonth[property] ? difference / metrics.previousMonth[property] : 0;
    const direction = difference >= 0 ? "up" : "down";
    const value = property === "revenue" ? formatCurrency(Math.abs(difference)) : formatNumber(Math.abs(difference));

    return `${formatMonth(metrics.lastMonth.month)} is ${direction} ${value} (${formatPercent(Math.abs(ratio))}) versus ${formatMonth(metrics.previousMonth.month)}.`;
}