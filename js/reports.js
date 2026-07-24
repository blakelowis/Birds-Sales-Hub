function drawSectionHeader(pdf, title, y){
    pdf.setFillColor(135,157,130);
  pdf.rect(10, y-6, 190, 8, 'F');
  pdf.setTextColor(255,255,255);
  pdf.setFontSize(11);
  pdf.text(title.toUpperCase(), 12, y);
  pdf.setTextColor(0,0,0);
}

function safeCanvasPNG(canvas, label) {
    // PATCH: SAFE_CANVAS_PNG - guards every canvas->PDF image insertion.
    // jsPDF's addImage() throws a generic "Incomplete or corrupt PNG file"
    // error with no indication of *which* image was bad. This validates the
    // canvas and its exported data first and logs exactly which element
    // failed, so a single missing/empty capture degrades gracefully instead
    // of aborting the whole multi-page export.
    try {
        if (!canvas || !canvas.width || !canvas.height) {
            console.warn(`[Store Report Export] Skipped "${label}" — canvas was empty (0px). It will be left out of the PDF.`);
            return null;
        }
        const data = canvas.toDataURL('image/png');
        if (!data || data.length < 100 || !data.startsWith('data:image/png')) {
            console.warn(`[Store Report Export] Skipped "${label}" — canvas produced invalid image data.`);
            return null;
        }
        return data;
    } catch (e) {
        console.warn(`[Store Report Export] Skipped "${label}" — error reading canvas:`, e);
        return null;
    }
}

async function renderElementToCanvas(el, {forceWidth=null} = {}){
  const target = el; const expandEls = target.querySelectorAll('.overflow-y-auto, [class*="max-h-"]'); const originalStyles = [];
  expandEls.forEach(n => { originalStyles.push({ el: n, overflow: n.style.overflow, maxHeight: n.style.maxHeight, height: n.style.height }); n.style.overflow = 'visible'; n.style.maxHeight = 'none'; n.style.height = 'auto'; });
  await new Promise(r => requestAnimationFrame(() => r()));
  const rect = target.getBoundingClientRect(); const cssWidth = forceWidth ? forceWidth : Math.ceil(Math.max(target.scrollWidth, rect.width)); const cssHeight = Math.ceil(target.scrollHeight + 20);
  const canvas = await html2canvas(target, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false, width: cssWidth, height: cssHeight, windowWidth: cssWidth, windowHeight: cssHeight, scrollX: -window.scrollX, scrollY: -window.scrollY, onclone: (doc) => { try { const cloneEl = target.id ? doc.getElementById(target.id) : null; if(!cloneEl) return; cloneEl.classList.add('export-force-landscape'); if(forceWidth) cloneEl.style.width = forceWidth + 'px'; } catch(e) {} } });
  originalStyles.forEach(item => { item.el.style.overflow = item.overflow; item.el.style.maxHeight = item.maxHeight; item.el.style.height = item.height; });
  return canvas;
}

window.exportCard = function(cardId, name) {

  const el = document.getElementById(cardId);
  if(!el) return;

  const btn = el.querySelector('.export-btn');
  if(btn) btn.style.display = 'none';

  const isChampion =
      cardId &&
      cardId.startsWith('monthly-champion');

  if(isChampion){
      el.classList.add('champion-export-mode');
  }

  renderElementToCanvas(
      el,
      isChampion
          ? { forceWidth: 900 }
          : { forceWidth: 1800 }
  ).then(canvas => {

      const link = document.createElement('a');

      link.download =
          `Birds_Report_${name.replace(/\s+/g,'_')}.png`;

      link.href =
          canvas.toDataURL('image/png');

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if(btn) btn.style.display = 'flex';

      if(isChampion){
          el.classList.remove('champion-export-mode');
      }

  });
}

window.exportAllCardsToZip = async function() {
    const btn = document.getElementById('export-all-btn'); const originalText = btn.innerHTML; btn.innerHTML = '⏳ Zipping Data...'; btn.disabled = true;
    const zip = new JSZip(); const cards = document.querySelectorAll('.area-card-export');
    for(let i=0; i<cards.length; i++){
        const card = cards[i]; const amName = card.getAttribute('data-am'); const exBtn = card.querySelector('.export-btn');
        if(exBtn) exBtn.style.display = 'none'; card.classList.add('export-force-landscape');
        const canvas = await html2canvas(card, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, width: 1400 });
        const base64Data = canvas.toDataURL('image/png').split(',')[1]; zip.file(`Birds_Area_Report_${amName.replace(/\s+/g, '_')}_${currentTimeFilter}.png`, base64Data, {base64: true});
        if(exBtn) exBtn.style.display = 'flex'; card.classList.remove('export-force-landscape');
    }
    const stamp=new Date().toISOString().slice(0,10);
    const content = await zip.generateAsync({type: 'blob'}); safeDownload(content, `Birds_Area_Reports_${currentTimeFilter}_${stamp}.zip`);
    btn.innerHTML = originalText; btn.disabled = false;
}

let __storeReportExportInProgress = false;
window.exportFullStoreReport = async function() {
    const __store=(document.getElementById('storeReportStore')?.value||'').trim();
    if(!__store){ alert('Please select a store first.'); return; }

    if (__storeReportExportInProgress) { alert('A store report export is already in progress. Please wait for it to finish.'); return; }
    __storeReportExportInProgress = true;

    const __genBtn = document.getElementById('btn-generate-store-report');
    const __genBtnOriginalText = __genBtn ? __genBtn.innerHTML : null;
    if (__genBtn) { __genBtn.disabled = true; __genBtn.innerHTML = 'Generating report…'; __genBtn.style.opacity = '0.6'; __genBtn.style.cursor = 'not-allowed'; }

    try {
        await __exportFullStoreReportInner(__store);
    } catch (err) {
        console.error('Store report export failed:', err);
        alert('Store report export failed: ' + (err?.message || err));
    } finally {
        __storeReportExportInProgress = false;
        if (__genBtn) { __genBtn.disabled = false; __genBtn.innerHTML = __genBtnOriginalText; __genBtn.style.opacity = ''; __genBtn.style.cursor = ''; }
    }
}

async function __exportFullStoreReportInner(__store) {
let storeName = __store;

if (!storeName) {
    alert('Please select a store.');
    return;
}

    const { jsPDF } = window.jspdf;
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    const wait = (t = 800) => new Promise(r => setTimeout(r, t));

    const storeId = canonicalStoreId(storeName);
    const executiveSummary = [];

    const MINT = [135, 157, 130];
    const CHARCOAL = [57, 68, 60];
    const LIGHT_GREY = [126, 137, 128];

    const PAGE_WIDTH = 210;
    const PAGE_CENTER_X = 105;

    // Always YTD
    const allKpi = await idbGetAll('kpi');
    const latestWeek = Math.max(1, ...allKpi.map(k => k.Week || 0).filter(Boolean));
    let weekFrom = 1, weekTo = latestWeek;
    let periodLabel = 'YTD (Wk 1-' + latestWeek + ')';
    window.__storeReportWeekRange = { from: weekFrom, to: weekTo };

    /* ==================================================
       COVER PAGE (Scorecard + Rank Timeline)
       ================================================== */
    setView('storecards');
    await wait(900);

    const card = [...document.querySelectorAll('[id^="card-"]')]
        .find(c => canonicalStoreId(c.innerText).includes(storeId));

    // Headers
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(...CHARCOAL);
    pdf.text('Store Performance Report', PAGE_CENTER_X, 22, { align: 'center' });

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(36);
    pdf.setTextColor(...MINT);
    pdf.text(storeName, PAGE_CENTER_X, 36, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...LIGHT_GREY);
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    pdf.text(`Generated: ${dateStr}`, PAGE_CENTER_X, 45, { align: 'center' });

    pdf.setDrawColor(225, 225, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, 52, 190, 52);

    let finalY = 60;

    // 1. Draw Scorecard
    if (card) {
        const canvas = await renderElementToCanvas(card, { forceWidth: 1200 });
        const png = safeCanvasPNG(canvas, 'Store Scorecard');
        if (png) {
            const ratio = canvas.height / canvas.width;

            const maxWidth = 175;
            const height = maxWidth * ratio;
            const xPos = (PAGE_WIDTH - maxWidth) / 2;

            pdf.addImage(png, 'PNG', xPos, finalY, maxWidth, height);
            finalY += height + 15; // Shift Y down for the next element
        }
    }

    // 2. Draw Rank Movement Chart directly underneath
    const tempCanvas = document.createElement('canvas');
    tempCanvas.id = 'rankChartTemp';
    tempCanvas.width = 900;
    tempCanvas.height = 700; // overwritten to 550 inside drawRankMovementChart to match its fixed export size
    document.body.appendChild(tempCanvas);

    try {
        await drawRankMovementChart(storeName, 'rankChartTemp');
    } catch (rankErr) {
        console.error('Failed to render rank movement chart:', rankErr);
    }
    await new Promise(r => requestAnimationFrame(() => r()));

    const rmPng = safeCanvasPNG(tempCanvas, 'Rank Movement Timeline');
    if (rmPng) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(...CHARCOAL);
        pdf.text('Rank Movement Timeline', PAGE_CENTER_X, finalY, { align: 'center' });

        finalY += 5;

        const rmChartWidth = 170;
        const rmChartHeight = rmChartWidth * (tempCanvas.height / tempCanvas.width);
        const rmChartX = (PAGE_WIDTH - rmChartWidth) / 2;

        pdf.addImage(rmPng, 'PNG', rmChartX, finalY, rmChartWidth, rmChartHeight);
        finalY += rmChartHeight + 15;
    }
    tempCanvas.remove();

    /* ==================================================
       TREND PAGES
       ================================================== */
    pdf.addPage('p'); 

    let y = 18;
    setView('trends');
    await wait(900);

    const metrics = [
        'Sales', 'Product', 'Waste', 'Labour', 'ATV', 
        'Energy', 'HotBev', 'HotRolls', 'FilledRolls', 'Sandwiches'
    ];
    const costMetrics = ['Waste', 'Labour', 'Energy'];

    for (let i = 0; i < metrics.length; i++) {
        if (i > 0) {
            pdf.addPage('p');
            y = 18;
        }

        const metricSel = document.getElementById('trendMetric');
        const storeSel = document.getElementById('trendStoreFilter');
        if (!metricSel || !storeSel) { console.warn('Trend controls not found, skipping metric', metrics[i]); continue; }
        metricSel.value = metrics[i];
        storeSel.value = storeName;

        try {
            await drawTrendChart(true, true); // exportMode=true: fixed size, no animation, renders synchronously
        } catch (chartErr) {
            console.error('Failed to render trend chart for', metrics[i], chartErr);
            continue;
        }
        await new Promise(r => requestAnimationFrame(() => r()));

        const c = document.getElementById('trendCanvas');
        if (!c) continue;
        const trendPng = safeCanvasPNG(c, `${metrics[i]} Trend Chart`);
        if (!trendPng) continue;

        const chartWidth = 176;
        const chartHeight = chartWidth * (c.height / c.width);

        const boxX = 13;
        const boxWidth = 184;

        pdf.setFillColor(248, 248, 248);
        pdf.roundedRect(boxX, y - 7, boxWidth, chartHeight + 30, 4, 4, 'F');

        pdf.setDrawColor(220, 220, 220);
        pdf.roundedRect(boxX, y - 7, boxWidth, chartHeight + 30, 4, 4);

        pdf.setFillColor(...MINT);
        pdf.roundedRect(boxX, y - 7, boxWidth, 8, 4, 4, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');

        pdf.text(metrics[i].toUpperCase() + ' PERFORMANCE', PAGE_CENTER_X, y - 1, { align: 'center' });

        pdf.addImage(trendPng, 'PNG', 17, y, chartWidth, chartHeight);

        try {
            const inverse = costMetrics.includes(metrics[i]);
            const storeData = trendChartInstance.data.datasets[0].data;
            const compData = trendChartInstance.data.datasets[1].data;
            const s = calculateTrendSummary(storeData, compData, inverse);

            const good = inverse ? s.under : s.above;
            const bad = inverse ? s.above : s.under;

            executiveSummary.push({ metric: metrics[i], good, near: s.near, bad, inverse });

            pdf.setFontSize(8);

            pdf.setFillColor(232, 238, 229);
            pdf.roundedRect(17, y + chartHeight + 5, 52, 10, 2, 2, 'F');
            pdf.setTextColor(96, 117, 95);
            pdf.text((inverse ? 'Below Avg ' : 'Above Avg ') + good + '%', 20, y + chartHeight + 11);

            pdf.setFillColor(239, 238, 229);
            pdf.roundedRect(79, y + chartHeight + 5, 52, 10, 2, 2, 'F');
            pdf.setTextColor(127, 111, 78);
            pdf.text('Within 1% ' + s.near + '%', 82, y + chartHeight + 11);

            pdf.setFillColor(241, 229, 225);
            pdf.roundedRect(141, y + chartHeight + 5, 52, 10, 2, 2, 'F');
            pdf.setTextColor(154, 98, 92);
            pdf.text((inverse ? 'Above Avg ' : 'Below Avg ') + bad + '%', 144, y + chartHeight + 11);

        } catch (e) {}

        y += chartHeight + 24;

        pdf.setDrawColor(230, 230, 230);
        pdf.line(15, y - 8, 195, y - 8);

        y += 8;
    }

    // Restore the live Trends canvas to normal responsive behaviour now export capture is done
    try {
        await drawTrendChart(true, false);
    } catch (e) { console.warn('Could not restore live trend chart after export', e); }

    /* ==================================================
       KPI SUMMARY PAGE (Centered Coaching Text)
       ================================================== */
    pdf.addPage('p');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.setTextColor(...CHARCOAL);
    pdf.text('Executive KPI Summary', PAGE_CENTER_X, 20, { align: 'center' });

    let sy = 40;

    // ── Well Done section ──────────────────────────
    const strengths = executiveSummary.sort((a, b) => b.good - a.good).slice(0, 3);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(...CHARCOAL);
    pdf.text('Well Done', PAGE_CENTER_X, sy, { align: 'center' });
    sy += 10;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');

    if (strengths.length > 0) {
        strengths.forEach(x => {
            pdf.setTextColor(96, 117, 95);
            let label = ['Waste', 'Labour', 'Energy'].includes(x.metric)
                ? `${x.metric} below company average in ${x.good}% of weeks`
                : `${x.metric} above company average in ${x.good}% of weeks`;
            pdf.text(`• ${label}`, PAGE_CENTER_X, sy, { align: 'center' });
            sy += 8;
        });
    } else {
        pdf.setTextColor(150, 150, 150);
        pdf.text('Performance tracking is building — keep going.', PAGE_CENTER_X, sy, { align: 'center' });
        sy += 8;
    }

    sy += 10;
    pdf.setDrawColor(213, 221, 208);
    pdf.line(55, sy, 155, sy);
    sy += 15;

    // ── Areas to Improve section ───────────────────
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...CHARCOAL);
    pdf.text('Areas to Improve', PAGE_CENTER_X, sy, { align: 'center' });
    sy += 10;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    const weaknesses = executiveSummary.sort((a, b) => b.bad - a.bad).slice(0, 5);

    if (weaknesses.length > 0) {
        weaknesses.forEach(x => {
            pdf.setTextColor(154, 98, 92);
            let focus = ['Waste', 'Labour', 'Energy'].includes(x.metric)
                ? `${x.metric} above company average in ${x.bad}% of weeks`
                : `${x.metric} below company average in ${x.bad}% of weeks`;
            pdf.text(`• ${focus}`, PAGE_CENTER_X, sy, { align: 'center' });
            sy += 8;
        });
    } else {
        pdf.setTextColor(150, 150, 150);
        pdf.text('No particular areas to improve this period — great work.', PAGE_CENTER_X, sy, { align: 'center' });
        sy += 8;
    }


    /* ==================================================
       MEDAL HISTORY PAGE (STORE SPECIFIC - CLEAN ALIGNMENT)
       ================================================== */
    pdf.addPage('p');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.setTextColor(55, 55, 55);
    pdf.text('Historical Medal Summary', PAGE_CENTER_X, 20, { align: 'center' });

    // Pull history from the global cache and filter by the current storeId
    let storeWins = (window.__areaWinsCache || []).filter(w => canonicalStoreId(w.Branch) === storeId);
    
    let groupedByWeek = {};
    let totals = {};

    // Group the data by week and tally the totals
    storeWins.forEach(w => {
        totals[w.Metric] = (totals[w.Metric] || 0) + 1;
        
        if (!groupedByWeek[w.Week]) {
            groupedByWeek[w.Week] = [];
        }
        groupedByWeek[w.Week].push(w.Metric);
    });

    let sortedWeeks = Object.keys(groupedByWeek).sort((a, b) => b - a);

    // Render each week as its own small canvas to avoid page overflow
    const medalPngWidth = 170;
    const medalPngX = (PAGE_WIDTH - medalPngWidth) / 2;
    let medalY = 30;
    const PAGE_MEDAL_LIMIT = 297 - 25;

    async function renderMedalChunk(html, label) {
        let chunkDiv = document.createElement('div');
        chunkDiv.style.position = 'absolute';
        chunkDiv.style.left = '-9999px';
        chunkDiv.style.top = '0';
        chunkDiv.innerHTML = html;
        document.body.appendChild(chunkDiv);
        await new Promise(r => setTimeout(r, 50));
        let chunkCanvas = await html2canvas(chunkDiv.firstElementChild, { scale: 2, backgroundColor: '#ffffff' });
        chunkDiv.remove();
        const png = safeCanvasPNG(chunkCanvas, label);
        if (!png) return;
        const chunkH = medalPngWidth * (chunkCanvas.height / chunkCanvas.width);
        if (medalY + chunkH > PAGE_MEDAL_LIMIT) {
            pdf.addPage('p');
            medalY = 20;
        }
        pdf.addImage(png, 'PNG', medalPngX, medalY, medalPngWidth, chunkH);
        medalY += chunkH + 6;
    }

    if (sortedWeeks.length === 0) {
        // No medals — just show a message
        let emptyHtml = `<div style="padding: 30px; background: #fbfaf6; width: 850px; font-family: 'Merriweather', Georgia, serif; text-align: center; color: #7e8a80; font-style: italic; font-weight: bold; font-size: 16px;">No medals accrued in the available data.</div>`;
        await renderMedalChunk(emptyHtml, 'No Medals');
    } else {
        // Render weeks in small batches (3 weeks per chunk) to avoid overflow
        const BATCH_SIZE = 3;
        for (let b = 0; b < sortedWeeks.length; b += BATCH_SIZE) {
            const batch = sortedWeeks.slice(b, b + BATCH_SIZE);
            let chunkHtml = `<div style="padding: 20px; background: white; width: 850px; font-family: 'Inter', sans-serif; box-sizing: border-box;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #e8eee5; text-align: left;">
                            <th style="padding: 12px 16px; border-bottom: 2px solid #d5ddd0; font-size: 14px; color: #39443c; text-transform: uppercase; letter-spacing: 0.05em; width: 110px;">Week</th>
                            <th style="padding: 12px 16px; border-bottom: 2px solid #d5ddd0; font-size: 14px; color: #39443c; text-transform: uppercase; letter-spacing: 0.05em;">Medals Awarded</th>
                        </tr>
                    </thead>
                    <tbody>`;

            batch.forEach(week => {
                let medalsListHtml = `<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">` + groupedByWeek[week].map(m => {
                    let isImp = m.includes('(Improvement)');
                    let metricName = m.replace(' (Improvement)', '').trim();
                    let badgeStyle = isImp 
                        ? 'color:#60755f; background:#e8eee5; border: 1px solid #879d82;'
                        : 'color:#927a4e; background:#f1eee2; border: 1px solid #d7c9a8;';
                    let impTag = isImp ? `<span style="background: #d5e1d1; color: #60755f; font-size: 10px; padding: 2px 6px; border-radius: 5px; margin-left: 8px; text-transform: uppercase; font-weight: 900;">Improved</span>` : '';
                    return `<div style="display: flex; align-items: center; padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 800; box-shadow: 0 1px 2px rgba(0,0,0,0.05); ${badgeStyle}">
                                <span>${metricName}</span>
                                ${impTag}
                            </div>`;
                }).join('') + `</div>`;

                chunkHtml += `<tr>
                    <td style="padding: 16px; border-bottom: 1px solid #e3e8df; color: #39443c; font-weight: 900; font-size: 16px; vertical-align: top;">Wk ${week}</td>
                    <td style="padding: 16px; border-bottom: 1px solid #e3e8df; vertical-align: top;">${medalsListHtml}</td>
                </tr>`;
            });

            chunkHtml += `</tbody></table></div>`;
            await renderMedalChunk(chunkHtml, 'Medals Wk ' + batch[0] + '-' + batch[batch.length - 1]);
        }

        // Medal Totals — render separately so it can start on a new page if needed
        let totalsHtml = `<div style="padding: 20px; background: #fbfaf6; width: 850px; font-family: 'Merriweather', Georgia, serif; box-sizing: border-box;">
            <h3 style="color: #39443c; font-size: 18px; font-weight: 900; margin-bottom: 16px; text-transform: uppercase; padding-left: 4px;">Medal Totals</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 14px;">`;

        for (let m in totals) {
            let isImp = m.includes('(Improvement)');
            let metricName = m.replace(' (Improvement)', '').trim();
            let impTagTotal = isImp ? `<span style="color: #60755f; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 3px;">Improved</span>` : ``;
            totalsHtml += `<div style="background: ${isImp ? '#e8eee5' : '#f1eee2'}; border: 1px solid ${isImp ? '#879d82' : '#d7c9a8'}; padding: 14px 20px; border-radius: 10px; color: #39443c; display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 200px; max-width: 280px; box-shadow: 0 1px 3px rgba(71,88,72,0.08);">
                <div style="display: flex; flex-direction: column; justify-content: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 15px; font-weight: 900;">${metricName}</span>
                    </div>
                    ${impTagTotal}
                </div>
                <span style="font-size: 28px; font-weight: 900; color: ${isImp ? '#60755f' : '#927a4e'}; margin-left: 16px;">${totals[m]}</span>
            </div>`;
        }
        totalsHtml += `</div></div>`;
        await renderMedalChunk(totalsHtml, 'Medal Totals');
    }

    /* ==================================================
       FOOTERS 
       ================================================== */
    const totalPages = pdf.internal.getNumberOfPages();

    for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);

        pdf.setDrawColor(225, 225, 225);
        pdf.line(15, 285, 195, 285);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(130, 130, 130);

        pdf.text('Birds Bakery Executive Reporting', 15, 290);
        pdf.text('Page ' + p + ' of ' + totalPages, 195, 290, { align: 'right' });
    }

    const stamp=new Date().toISOString().slice(0,10);
    pdf.save('Store_Report_' + storeName.replace(/\s+/g, '_') + '_' + stamp + '.pdf');
}

window.exportCurrentViewPNG = async function(){

    const body = document.getElementById('auditReportBody');

    if(!body){
        alert('auditReportBody not found');
        return;
    }

    const exportWrap = document.createElement('div');

    exportWrap.style.position='absolute';
    exportWrap.style.left='-99999px';
    exportWrap.style.top='0';
    exportWrap.style.background='#fff';
    exportWrap.style.padding='30px';
    exportWrap.style.width='1400px';

    const store =
        document.getElementById('auditStoreFilter')?.value ||
        'ALL_STORES';

    const area =
        document.getElementById('auditAreaFilter')?.value ||
        'ALL_AREAS';

    const sector =
        document.getElementById('auditSectorFilter')?.value ||
        'ALL_SECTORS';

    exportWrap.innerHTML = `
        <div style="
            border-bottom:4px solid #5B8C7A;
            margin-bottom:20px;
            padding-bottom:15px;
            font-family:Arial,sans-serif;
        ">
            <div style="
                font-size:42px;
                font-weight:900;
                color:#5B8C7A;
            ">
                AUDIT ACTION HUB
            </div>

            <div style="
                margin-top:10px;
                font-size:18px;
                line-height:1.8;
            ">
                <strong>Store:</strong> ${store}<br>
                <strong>Area:</strong> ${area}<br>
                <strong>Sector:</strong> ${sector}<br>
                <strong>Generated:</strong>
                ${new Date().toLocaleString('en-GB')}
            </div>
        </div>
    `;

    const clone = body.cloneNode(true);

    exportWrap.appendChild(clone);

    document.body.appendChild(exportWrap);

    //
    // EXPAND EVERYTHING
    //
    exportWrap.querySelectorAll('*').forEach(el => {

        try{

            const style =
                window.getComputedStyle(el);

            if(
                style.overflow === 'auto' ||
                style.overflow === 'scroll' ||
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll'
            ){
                el.style.overflow='visible';
                el.style.overflowY='visible';
            }

            if(style.maxHeight !== 'none'){
                el.style.maxHeight='none';
            }

            if(style.height &&
               style.height !== 'auto'){
                el.style.height='auto';
            }

        }catch(e){}
    });

    await new Promise(r=>setTimeout(r,1200));

    const canvas = await html2canvas(exportWrap,{
        scale:2,
        useCORS:true,
        backgroundColor:'#ffffff'
    });

    console.log(
        'FINAL CANVAS SIZE',
        canvas.width,
        canvas.height
    );

    const PAGE_HEIGHT = 3000;

    const totalPages =
        Math.ceil(
            canvas.height / PAGE_HEIGHT
        );

    const safeStore =
        String(store)
            .replace(/[^a-z0-9]/gi,'_');

    const dateStamp =
        new Date()
            .toISOString()
            .slice(0,10);

    const zip = new JSZip();

    for(let page=0; page<totalPages; page++){

        const pageCanvas =
            document.createElement('canvas');

        const sliceHeight =
            Math.min(
                PAGE_HEIGHT,
                canvas.height -
                page * PAGE_HEIGHT
            );

        pageCanvas.width =
            canvas.width;

        pageCanvas.height =
            sliceHeight;

        pageCanvas
            .getContext('2d')
            .drawImage(
                canvas,
                0,
                page * PAGE_HEIGHT,
                canvas.width,
                sliceHeight,
                0,
                0,
                canvas.width,
                sliceHeight
            );

        const pageName =
            'P' +
            String(page + 1)
                .padStart(2,'0') +
            '.png';

        zip.file(
            pageName,
            pageCanvas
                .toDataURL('image/png')
                .split(',')[1],
            {
                base64:true
            }
        );
    }

    const blob =
        await zip.generateAsync({
            type:'blob'
        });

    safeDownload(blob,
        safeStore +
        '_Audit_Action_Hub_' +
        dateStamp +
        '.zip');

    exportWrap.remove();
}

window.renderStoreReports = async function(){

    const stores =
        Array.from(
            originalStoreNames.values()
        ).sort();

    document.getElementById('mainView').innerHTML = `

    <div class="card p-6">

        <h2 class="text-2xl font-black birds-green">
            Store Reports
        </h2>

        <p class="text-slate-500 mb-6">
            Generate detailed YTD reports by store.
        </p>

        <div class="grid md:grid-cols-2 gap-4">

            <div>

                <label class="font-bold text-sm">
                    Store
                </label>

                <select
                    id="storeReportStore"
                    class="input-chip w-full mt-2">

                    ${stores.map(
                        s => `<option>${s}</option>`
                    ).join("")}

                </select>

            </div>

        </div>

        <div class="mt-6">

            <button
                id="btn-generate-store-report"
                onclick="exportFullStoreReport()"
                class="btn" style="background: #555B6E; color: white; padding: 10px 20px; border-radius: 6px; font-weight: 800; font-size: 13px;">

                Generate Store Report

            </button>

        </div>

    </div>

    `;
}

// ===== SECTIONAL REVIEW PACK =====
// Company / Area Manager review pack that mirrors the existing app sections.
let __reviewPackData = null;


function rpNum(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function rpPct(v){ return BirdsCore.pct(v); }
function rpMoney(v){ return BirdsCore.money(v); }
function rpAvg(arr, fn){ const vals=arr.map(fn).map(Number).filter(Number.isFinite); return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0; }
function rpCountBy(arr, fn){ const m=new Map(); arr.forEach(x=>{const k=fn(x)||'Unknown'; m.set(k,(m.get(k)||0)+1);}); return Array.from(m.entries()).sort((a,b)=>b[1]-a[1] || String(a[0]).localeCompare(String(b[0]))); }
function rpStoreId(name){ return canonicalStoreId(name || ''); }
function rpAreaFromStore(store){ return BirdsCore.getArea(store); }
function rpAreaOfKpi(k){ const am = safeGetAM(k.Branch) || rpAreaFromStore(k.Branch); return am==='Tom Henson'?'Thomas Henson':am; }
function rpStoreNameAction(a){ return cleanStoreName(a.Store || a.StoreName || a['Store Name'] || (a.StoreEmail ? String(a.StoreEmail).split('@')[0] : '') || 'Unknown Store'); }
function rpAreaAction(a){ let am = a.AreaManager || a.AM || rpAreaFromStore(rpStoreNameAction(a)); if(am==='Area Manager') am = rpAreaFromStore(rpStoreNameAction(a)); return am==='Tom Henson'?'Thomas Henson':am; }
function rpStatus(a){ if(typeof normalizeActionStatus==='function') return normalizeActionStatus(a.Status); return String(a.Status||'').toLowerCase().includes('closed')?'Closed':'Open'; }
function rpClosed(a){ return BirdsCore.isClosed(a.Status); }
function rpCritical(a){ if(typeof normalizeYesNo==='function') return normalizeYesNo(a.Critical)==='Yes'; return ['yes','true','critical'].includes(String(a.Critical||'').toLowerCase()); }
function rpTheme(a){ if(typeof auditIssueTheme==='function') return auditIssueTheme(a); return String(a.Description || a.Question || a.ActionNeeded || 'Uncategorised'); }
function rpActionDays(a){ if(rpClosed(a)) return Number(a.DaysToClose); const d=parseDateSafe(a.AuditDate || a.Date); return d?Math.max(0,(new Date()-d)/86400000):Number(a.DaysOpen); }
function rpSla(a){ if(typeof slaBucket==='function') return slaBucket(a); if(rpClosed(a)) return 'Closed'; const d=rpActionDays(a); if(rpCritical(a)&&d>2) return 'Critical > 48h'; if(d>30) return 'Open > 30 days'; if(d>14) return 'Open > 14 days'; if(d>7) return 'Open > 7 days'; return 'In SLA / New'; }
function rpWeekRange(period, latestWeek){
  if(period==='latest') return {from:latestWeek,to:latestWeek,prevFrom:latestWeek-1,prevTo:latestWeek-1,label:`Week ${latestWeek}`};
  if(period==='last4') return {from:Math.max(1,latestWeek-3),to:latestWeek,prevFrom:Math.max(1,latestWeek-7),prevTo:latestWeek-4,label:`Weeks ${Math.max(1,latestWeek-3)}-${latestWeek}`};
  if(period==='last13') return {from:Math.max(1,latestWeek-12),to:latestWeek,prevFrom:Math.max(1,latestWeek-25),prevTo:latestWeek-13,label:`Weeks ${Math.max(1,latestWeek-12)}-${latestWeek}`};
  return {from:1,to:latestWeek,prevFrom:null,prevTo:null,label:`YTD Weeks 1-${latestWeek}`};
}
function rpFilterWeek(rows, range){ return rows.filter(r => (r.Week||0) >= range.from && (r.Week||0) <= range.to); }
function rpFilterPrev(rows, range){ if(range.prevFrom==null) return []; return rows.filter(r => (r.Week||0) >= range.prevFrom && (r.Week||0) <= range.prevTo); }
function rpScopeRows(scope, kpis, audits, actions){
  if(scope==='ALL') return {kpis,audits,actions};
  return {
    kpis:kpis.filter(k=>rpAreaOfKpi(k)===scope),
    audits:audits.filter(a=>rpAreaFromStore(a.Store)===scope),
    actions:actions.filter(a=>rpAreaAction(a)===scope)
  };
}
function rpAggStores(kpis, audits){
  const m=new Map();
  kpis.filter(k=>!k.IsAnomaly).forEach(k=>{
    const id=rpStoreId(k.Branch); if(!m.has(id)) m.set(id,{id,Branch:k.Branch,AM:rpAreaOfKpi(k),rows:[],auditRows:[]});
    m.get(id).rows.push(k);
  });
  audits.forEach(a=>{ const id=rpStoreId(a.Store); if(!m.has(id)) m.set(id,{id,Branch:a.Store,AM:rpAreaFromStore(a.Store),rows:[],auditRows:[]}); m.get(id).auditRows.push(a); });
  return Array.from(m.values()).map(s=>{
    const avg=(f)=>rpAvg(s.rows,r=>r[f]); const aud=(f)=>rpAvg(s.auditRows,r=>r[f]);
    const obj={Branch:s.Branch,AM:s.AM,Sales:avg('Sales'),Product:avg('Product'),Waste:avg('Waste'),Labour:avg('Labour'),ATV:avg('ATV'),Energy:avg('Energy'),SalesActual:rpAvg(s.rows,r=>r.SalesActual || r.__rawSales || 0),AuditScore:aud('Score'),Food:aud('Food'),Fire:aud('Fire'),HandS:aud('HandS'),Journey:aud('Journey'),Coffee:aud('Coffee'),Focus:aud('Focus')};
    obj.Score = typeof calculateStoreScore==='function' ? calculateStoreScore(obj) : (obj.Sales*100 + obj.Product*100 - obj.Waste*100 - obj.Labour*100 - (obj.Energy||0)/100);
    return obj;
  });
}
function rpKpi(label, value, sub='', colour='birds-green'){
  return `<div class="card p-5 border-t-4 ${colour==='red'?'border-t-red-500':colour==='amber'?'border-t-amber-400':'border-t-birds-green'}"><div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${label}</div><div class="text-3xl font-black ${colour==='red'?'text-red-600':colour==='amber'?'text-amber-600':'birds-green'}">${value}</div><div class="text-xs font-bold text-slate-500 mt-1">${sub}</div></div>`;
}
function rpTrend(label, curr, prev, inverse=false, format='pct'){
  const diff = curr - prev; const good = inverse ? diff < 0 : diff > 0; const arrow = diff===0?'—':diff>0?'Up':'Down';
  const fmt = format==='money' ? '£'+Math.abs(diff).toFixed(2) : format==='whole' ? Math.abs(diff).toFixed(0) : (Math.abs(diff)*100).toFixed(1)+'%';
  return `<div class="card p-4"><div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${label}</div><div class="text-2xl font-black text-slate-800">${format==='money'?rpMoney(curr):format==='whole'?Math.round(curr):rpPct(curr)}</div><div class="text-xs font-black ${diff===0?'text-slate-400':good?'text-emerald-600':'text-red-600'}">${arrow} ${diff===0?'No change':fmt} vs previous</div></div>`;
}
function rpSparkline(data, inverse=false, width=120, height=32){
  if(!data || data.length < 2) return '';
  const clean = data.filter(v => v != null && Number.isFinite(v));
  if(clean.length < 2) return '';
  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const pad = 2;
  const w = width - pad*2, h = height - pad*2;
  const pts = clean.map((v, i) => {
    const x = pad + (i / (clean.length - 1)) * w;
    const y = pad + (1 - (v - min) / range) * h;
    return `${x},${y}`;
  });
  const colour = inverse ? '#F59E0B' : '#5B8C7A';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="inline-block align-middle"><polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function rpBreakdown(title, pairs){ return `<div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">${title}</h3>${pairs.length?pairs.map(([n,c])=>`<div class="flex justify-between gap-3 py-2 border-b border-slate-100 last:border-0"><span class="text-xs font-bold text-slate-700">${escapeHtml(n)}</span><span class="font-black birds-green">${c}</span></div>`).join(''):'<p class="text-slate-400 italic">No data.</p>'}</div>`; }
function rpOpenClosed(title, rows){ return `<div class="card p-5"><h3 class="font-black outfit text-sm uppercase tracking-widest text-slate-400 mb-4">${title}</h3>${rows.length?rows.map(x=>`<div class="mb-3"><div class="flex justify-between text-xs font-black"><span>${escapeHtml(x.name)}</span><span>${x.open} open / ${x.closed} closed</span></div><div class="progress-bar"><div class="progress-fill-warn" style="width:${x.total?x.open/x.total*100:0}%"></div></div></div>`).join(''):'<p class="text-slate-400 italic">No data.</p>'}</div>`; }
function rpOpenClosedRows(actions, fn){ const m=new Map(); actions.forEach(a=>{const k=fn(a)||'Unknown'; if(!m.has(k))m.set(k,{name:k,open:0,closed:0,total:0}); const o=m.get(k); o.total++; if(rpClosed(a))o.closed++; else o.open++;}); return Array.from(m.values()).sort((a,b)=>b.open-a.open||b.total-a.total).slice(0,12); }
function rpBandStores(allStores, scopeStores){
  const sorted=allStores.filter(s=>s.SalesActual>0).sort((a,b)=>b.SalesActual-a.SalesActual);
  if(sorted.length===0) return scopeStores.map(s=>({...s,Band:'No Actual Sales data'})).sort((a,b)=>(b.Sales||0)-(a.Sales||0));
  const n=sorted.length; const bandMap=new Map();
  sorted.forEach((s,i)=>{ const p=(i+1)/n; const band=p<=0.25?'A - High Sales':p<=0.5?'B - Upper Mid':p<=0.75?'C - Lower Mid':'D - Developing'; bandMap.set(rpStoreId(s.Branch),band); });
  return scopeStores.map(s=>({...s,Band:bandMap.get(rpStoreId(s.Branch)) || 'No sales actual'})).sort((a,b)=>b.SalesActual-a.SalesActual);
}
/* ════════════════════════════════════════════════════════════════
   QUARTERLY SUMMARY
   ════════════════════════════════════════════════════════════════ */

const _qsDef = [
  { name:'Sales',        field:'Sales',       type:'pct', inverse:false },
  { name:'Product',      field:'Product',     type:'pct', inverse:false },
  { name:'Waste',        field:'Waste',       type:'pct', inverse:true  },
  { name:'Labour',       field:'Labour',      type:'pct', inverse:true  },
  { name:'ATV',          field:'ATV',         type:'val', inverse:false },
  { name:'Energy',       field:'Energy',      type:'val', inverse:true  },
  { name:'Hot Drinks',   field:'HotBev',      type:'count', inverse:false },
  { name:'Hot Food',     field:'HotRolls',    type:'count', inverse:false },
  { name:'Filled Rolls', field:'FilledRolls', type:'count', inverse:false },
  { name:'Sandwiches',   field:'Sandwiches',  type:'count', inverse:false }
];

const _qsQtrWk = {
  'Q1':{from:1,to:13}, 'Q2':{from:14,to:26},
  'Q3':{from:27,to:39}, 'Q4':{from:40,to:52}
};

function _qsAvg(rows, f){ const v=rows.filter(r=>!r.IsAnomaly).map(r=>r[f]).filter(x=>Number.isFinite(x)); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; }

function _qsFmt(val, type){
  if(val==null) return '—';
  if(type==='val') return '£'+val.toFixed(2);
  if(type==='count') return Math.round(val).toLocaleString();
  return (val*100).toFixed(1)+'%';
}

function _qsDeltaFmt(diff, type){
  if(diff==null) return '';
  if(type==='val') return '£'+Math.abs(diff).toFixed(2);
  if(type==='count') return Math.abs(Math.round(diff)).toLocaleString();
  return Math.abs(diff*100).toFixed(1)+'%';
}

function _qsWidget(m, firstAvg, lastAvg, firstWk, lastWk){
  let delta=null, good=null;
  if(firstAvg!=null && lastAvg!=null){ delta=lastAvg-firstAvg; good=m.inverse?delta<0:delta>0; }
  const firstStr=_qsFmt(firstAvg,m.type);
  const lastStr=_qsFmt(lastAvg,m.type);
  let deltaHtml='<span class="text-[11px] font-bold text-slate-400">No data</span>';
  let dCls='text-slate-400';
  if(delta!=null){
    const tiny=Math.abs(delta)<(m.type==='val'?0.005:0.005);
    const arrow=tiny?'—':delta>0?'Up':'Down';
    dCls=tiny?'text-slate-400':good?'text-emerald-600':'text-red-600';
    const dFmt=_qsDeltaFmt(delta,m.type);
    deltaHtml=`<span class="text-sm font-black ${dCls}">${arrow} ${dFmt} Wk${firstWk}→${lastWk}</span>`;
  }
  const borderCls=delta==null?'border-t-slate-200':good?'border-t-emerald-500':'border-t-red-500';
  const valCls=delta==null?'text-slate-700':good?'text-emerald-700':'text-red-700';
  const varCls=delta==null?'text-slate-400':good?'text-emerald-600':'text-red-600';
  return `<div class="card p-5 border-t-4 ${borderCls}">
    <div class="flex items-center justify-between mb-1">
      <span class="text-[11px] font-black text-slate-400 uppercase tracking-widest">${m.name}</span>
      ${deltaHtml}
    </div>
    <div class="flex items-center justify-between mt-2 text-[11px] font-bold">
      <span class="text-slate-500">First: ${firstStr}</span>
      <span class="text-slate-500">Last: ${lastStr}</span>
    </div>
  </div>`;
}

window.renderQuarterlySummary = async function(){
  const kAll = await idbGetAll('kpi');
  const latestWeek = Math.max(1,...kAll.map(k=>k.Week||0).filter(Boolean));
  const latestYear = Math.max(1,...kAll.map(k=>k.Year||0).filter(Boolean));

  function normAM(n){ return (n||'').trim()==='Tom Henson'?'Thomas Henson':(n||'').trim(); }
  const ams=new Set();
  Array.from(storeMap.values()).forEach(v=>{v=normAM(v); if(v&&v!=='Unassigned')ams.add(v);});

  const allBranches=[...new Set(kAll.map(k=>k.Branch).filter(Boolean))].sort();
  const availQ=['Q1','Q2','Q3','Q4'].filter(q=>_qsQtrWk[q].from<=latestWeek);

  const areaOpts=`<option value="">All Areas</option>`+Array.from(ams).sort().map(a=>`<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  const storeOpts=`<option value="">All Stores</option>`+allBranches.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const qOpts=`<option value="YTD" selected>YTD</option>`+availQ.map(q=>`<option value="${q}">${q}</option>`).join('');

  document.getElementById('mainView').innerHTML=`
    <div id="qs-dash" class="space-y-6">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 class="text-[36px] font-black outfit birds-green uppercase tracking-tight">Quarterly Summary</h2>
          <p class="text-slate-500 font-bold">Select area, store and quarter to visualise performance.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <select id="qsArea" class="input-chip text-sm">${areaOpts}</select>
          <select id="qsStore" class="input-chip text-sm">${storeOpts}</select>
          <select id="qsQuarter" class="input-chip text-sm">${qOpts}</select>
          <button onclick="exportQSPDF()" class="btn" style="background: var(--edwardian-rose); color: white; padding: 8px 16px; border-radius: 6px; font-weight: 800; font-size: 13px;">PDF Export</button>
        </div>
      </div>
      <div id="qsContext" class="text-xs font-bold text-slate-400"></div>
      <div id="qsWidgets" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
    </div>`;

  document.getElementById('qsArea').addEventListener('change', function(){
    const area=this.value;
    const filtered=area?allBranches.filter(s=>normAM(storeMap.get(canonicalStoreId(s)))===area):allBranches;
    document.getElementById('qsStore').innerHTML=`<option value="">All Stores</option>`+filtered.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    _qsRefresh();
  });
  document.getElementById('qsStore').addEventListener('change', _qsRefresh);
  document.getElementById('qsQuarter').addEventListener('change', _qsRefresh);
  await _qsRefresh();
};

async function _qsRefresh(){
  const area=document.getElementById('qsArea')?.value||'';
  const store=document.getElementById('qsStore')?.value||'';
  const quarter=document.getElementById('qsQuarter')?.value||'YTD';

  function normAM(n){ return (n||'').trim()==='Tom Henson'?'Thomas Henson':(n||'').trim(); }

  const kAll=await idbGetAll('kpi');
  const latestWeek=Math.max(1,...kAll.map(k=>k.Week||0).filter(Boolean));
  const latestYear=Math.max(1,...kAll.map(k=>k.Year||0).filter(Boolean));

  let data=kAll.filter(k=>(k.Year||latestYear)===latestYear);
  if(area) data=data.filter(k=>normAM(safeGetAM(k.Branch)||rpAreaFromStore(k.Branch)).toLowerCase()===area.toLowerCase());
  if(store) data=data.filter(k=>k.Branch===store);

  const qw=quarter==='YTD'?{from:1,to:latestWeek}:_qsQtrWk[quarter];
  const periodTo=Math.min(qw.to,latestWeek);
  const currData=data.filter(k=>k.Week>=qw.from&&k.Week<=periodTo);

  const weekMap={};
  currData.forEach(k=>{ if(!weekMap[k.Week]) weekMap[k.Week]=[]; weekMap[k.Week].push(k); });
  const weeks=Object.keys(weekMap).map(Number).sort((a,b)=>a-b);

  const firstWk=weeks[0], lastWk=weeks[weeks.length-1];
  const firstRows=weekMap[firstWk]||[];
  const lastRows=weekMap[lastWk]||[];

  const label=store||area||'Company';
  const qLabel=quarter==='YTD'?`YTD (Wk 1-${periodTo})`:`${quarter} (Wk ${qw.from}-${periodTo})`;
  const ctx=document.getElementById('qsContext');
  if(ctx) ctx.textContent=`${label} — ${qLabel}`;

  const widgets=_qsDef.map(m=>{
    const fAvg=_qsAvg(firstRows,m.field);
    const lAvg=_qsAvg(lastRows,m.field);
    return _qsWidget(m,fAvg,lAvg,firstWk,lastWk);
  }).join('');

  document.getElementById('qsWidgets').innerHTML=widgets;
}

window.exportQSPDF = async function(){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','mm','a4');
  const pw=210, ph=297, mg=15, cw=pw-mg*2;

  const area=document.getElementById('qsArea')?.value||'';
  const store=document.getElementById('qsStore')?.value||'';
  const quarter=document.getElementById('qsQuarter')?.value||'YTD';

  const kAll=await idbGetAll('kpi');
  const latestWeek=Math.max(1,...kAll.map(k=>k.Week||0).filter(Boolean));
  const latestYear=Math.max(1,...kAll.map(k=>k.Year||0).filter(Boolean));
  function normAM(n){ return (n||'').trim()==='Tom Henson'?'Thomas Henson':(n||'').trim(); }

  let data=kAll.filter(k=>(k.Year||latestYear)===latestYear);
  if(area) data=data.filter(k=>normAM(safeGetAM(k.Branch)||rpAreaFromStore(k.Branch)).toLowerCase()===area.toLowerCase());
  if(store) data=data.filter(k=>k.Branch===store);

  const qw=quarter==='YTD'?{from:1,to:latestWeek}:_qsQtrWk[quarter];
  const periodTo=Math.min(qw.to,latestWeek);
  const currData=data.filter(k=>k.Week>=qw.from&&k.Week<=periodTo);

  const weekMap={};
  currData.forEach(k=>{ if(!weekMap[k.Week]) weekMap[k.Week]=[]; weekMap[k.Week].push(k); });
  const weeks=Object.keys(weekMap).map(Number).sort((a,b)=>a-b);
  const firstWk=weeks[0], lastWk=weeks[weeks.length-1];
  const firstRows=weekMap[firstWk]||[];
  const lastRows=weekMap[lastWk]||[];

  const label=store||area||'Company';
  const qLabel=quarter==='YTD'?`YTD (Wk 1-${periodTo})`:quarter+' (Wk '+qw.from+'-'+periodTo+')';
  const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
  const stamp=new Date().toISOString().slice(0,10);

  // ── Header ──
    pdf.setFillColor(135,157,130);
  pdf.rect(0,0,pw,2,'F');
  pdf.setFont('helvetica','bold');
  pdf.setFontSize(22);
    pdf.setTextColor(96,117,95);
  pdf.text('Quarterly Summary',pw/2,18,{align:'center'});
  pdf.setFontSize(14);
  pdf.setTextColor(40,40,40);
  pdf.text(label,pw/2,26,{align:'center'});
  pdf.setFontSize(11);
  pdf.setTextColor(100,100,100);
  pdf.text(qLabel+' - '+today,pw/2,33,{align:'center'});
  pdf.setDrawColor(200,200,200);
  pdf.line(mg,37,pw-mg,37);

  // ── Compute metrics ──
  const metrics=_qsDef.map(m=>{
    const fAvg=_qsAvg(firstRows,m.field);
    const lAvg=_qsAvg(lastRows,m.field);
    let delta=null, good=null;
    if(fAvg!=null&&lAvg!=null){ delta=lAvg-fAvg; good=m.inverse?delta<0:delta>0; }
    return { name:m.name, type:m.type, first:fAvg, last:lAvg, delta, good };
  });

  // ── Layout: 3 columns, rows auto ──
  const cols=3, gap=4, boxW=(cw-gap*(cols-1))/cols, boxH=30;
  const startY=42;
  let x=mg, y=startY;

  metrics.forEach((m,i)=>{
    if(i>0 && i%cols===0){ x=mg; y+=boxH+gap; }
    if(y+boxH>ph-mg){ pdf.addPage(); y=mg; pdf.setFillColor(135,157,130); pdf.rect(0,0,pw,2,'F'); }

    // box background
    pdf.setFillColor(251,250,246);
    pdf.setDrawColor(213,221,208);
    pdf.roundedRect(x,y,boxW,boxH,2,2,'FD');

    // colored top bar
    const barClr=m.good===null?[190,194,187]:m.good?[135,157,130]:[164,111,104];
    pdf.setFillColor(...barClr);
    pdf.rect(x,y,boxW,2,'F');

    // metric name
    pdf.setFont('helvetica','bold');
    pdf.setFontSize(8);
    pdf.setTextColor(96,108,98);
    pdf.text(m.name.toUpperCase(),x+3,y+7);

    // delta arrow (ASCII only for PDF)
    if(m.delta!=null){
      const tiny=Math.abs(m.delta)<0.005;
      const arrow=tiny?'':m.delta>0?'+':'-';
      const dFmt=m.type==='val'?'£'+Math.abs(m.delta).toFixed(2):Math.abs(m.delta*100).toFixed(1)+'%';
    const dClr=m.good===null?[100,108,100]:m.good?[96,117,95]:[154,98,92];
      pdf.setFontSize(7);
      pdf.setTextColor(...dClr);
      const deltaText=(arrow?arrow+' ':'')+dFmt+' Wk'+firstWk+'-'+lastWk;
      pdf.text(deltaText,x+boxW-3,y+7,{align:'right'});
    }

    // first value
    pdf.setFontSize(8);
    pdf.setTextColor(100,100,100);
    const fStr=m.type==='val'?'£'+m.first.toFixed(2):(m.first*100).toFixed(1)+'%';
    pdf.setFont('helvetica','normal');
    pdf.text('First: '+fStr,x+3,y+15);

    // last value
    const lStr=m.type==='val'?'£'+m.last.toFixed(2):(m.last*100).toFixed(1)+'%';
    pdf.text('Last: '+lStr,x+3,y+21);

    // last value large
    pdf.setFont('helvetica','bold');
    pdf.setFontSize(13);
    const vClr=m.good===null?[57,68,60]:m.good?[96,117,95]:[145,86,80];
    pdf.setTextColor(...vClr);
    pdf.text(lStr,x+boxW-3,y+24,{align:'right'});

    x+=boxW+gap;
  });

  // ── Footer ──
  const totalPages=pdf.getNumberOfPages();
  for(let p=1;p<=totalPages;p++){
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setTextColor(160,160,160);
    pdf.text('Birds Executive Hub - Quarterly Summary',mg,ph-5);
    pdf.text('Page '+p+' of '+totalPages,pw-mg,ph-5,{align:'right'});
  }

  const fileLabel=label.replace(/[^a-zA-Z0-9]/g,'_');
  pdf.save(fileLabel+'_Quarterly_Summary_'+stamp+'.pdf');
};

async function buildRankTimeline(storeName){
    if (!storeName) return [];
    const allKpi = await idbGetAll('kpi');
    if (!allKpi || allKpi.length === 0) return [];

    const latestYear = Math.max(1, ...allKpi.map(k => k.Year || 0).filter(Boolean));
    const yearData = allKpi.filter(k => (k.Year || latestYear) === latestYear);

    const weekMap = {};
    yearData.forEach(k => {
        const w = k.Week;
        if (!w) return;
        if (!weekMap[w]) weekMap[w] = [];
        weekMap[w].push(k);
    });

    const weekScores = {};
    Object.keys(weekMap).map(Number).sort((a, b) => a - b).forEach(week => {
        const weekRows = weekMap[week];
        const storeScores = {};
        weekRows.forEach(k => {
            const branch = k.Branch;
            if (!branch) return;
            if (!storeScores[branch]) storeScores[branch] = 0;
            const sales = Number(k.Sales) || 0;
            const product = Number(k.Product) || 0;
            const waste = Number(k.Waste) || 0;
            const labour = Number(k.Labour) || 0;
            storeScores[branch] += (sales * 100 + product * 100 - waste * 100 - labour * 100);
        });
        weekScores[week] = storeScores;
    });

    const sortedWeeks = Object.keys(weekScores).map(Number).sort((a, b) => a - b);
    const ROLLING_WINDOW = 4;
    const timeline = [];

    sortedWeeks.forEach((week, idx) => {
        const windowStart = Math.max(0, idx - ROLLING_WINDOW + 1);
        const windowWeeks = sortedWeeks.slice(windowStart, idx + 1);

        const cumulativeScores = {};
        windowWeeks.forEach(w => {
            const ws = weekScores[w];
            Object.entries(ws).forEach(([branch, score]) => {
                cumulativeScores[branch] = (cumulativeScores[branch] || 0) + score;
            });
        });

        const sorted = Object.entries(cumulativeScores).sort((a, b) => b[1] - a[1]);
        const rank = sorted.findIndex(([name]) => canonicalStoreId(name) === canonicalStoreId(storeName)) + 1;
        const storeId = canonicalStoreId(storeName);
        timeline.push({ week, rank, total: sorted.length, score: cumulativeScores[storeId] || 0 });
    });

    return timeline;
}

async function drawRankMovementChart(storeName, canvasId){
    const timeline = await buildRankTimeline(storeName);
    if (!timeline || timeline.length === 0) return;

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.width = 900;
    canvas.height = 550;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 900, 550);

    const MINT = '#879d82';
    const CHARCOAL = '#39443c';
    const LIGHT_GREY = '#d5ddd0';
    const PAD = { top: 70, right: 40, bottom: 60, left: 60 };
    const chartW = 900 - PAD.left - PAD.right;
    const chartH = 550 - PAD.top - PAD.bottom;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 900, 550);

    // Title
    ctx.fillStyle = CHARCOAL;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(storeName + ' \u2014 Rank Movement', 450, 30);
    ctx.font = '12px Arial';
    ctx.fillStyle = '#888888';
    ctx.fillText('Rank per week (1 = Best)', 450, 50);

    const maxRank = Math.max(...timeline.map(t => t.rank), 1);
    const minRank = 1;
    const totalRanks = Math.max(maxRank, 10);

    // Grid lines
    ctx.strokeStyle = LIGHT_GREY;
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= totalRanks; i++) {
        const y = PAD.top + ((i - 1) / (totalRanks - 1)) * chartH;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(900 - PAD.right, y);
        ctx.stroke();

        ctx.fillStyle = '#888888';
        ctx.font = '11px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('#' + i, PAD.left - 8, y);
    }

    // X axis labels
    ctx.fillStyle = '#888888';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = Math.max(1, Math.floor(timeline.length / 12));
    timeline.forEach((t, i) => {
        if (i % step === 0 || i === timeline.length - 1) {
            const x = PAD.left + (i / (timeline.length - 1)) * chartW;
            ctx.fillText('Wk ' + t.week, x, PAD.top + chartH + 8);
        }
    });

    // Line
    ctx.beginPath();
    ctx.strokeStyle = MINT;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    timeline.forEach((t, i) => {
        const x = PAD.left + (i / (timeline.length - 1)) * chartW;
        const y = PAD.top + ((t.rank - 1) / (totalRanks - 1)) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under line
    ctx.lineTo(PAD.left + chartW, PAD.top + chartH);
    ctx.lineTo(PAD.left, PAD.top + chartH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(135, 157, 130, 0.14)';
    ctx.fill();

    // Dots + labels
    timeline.forEach((t, i) => {
        const x = PAD.left + (i / (timeline.length - 1)) * chartW;
        const y = PAD.top + ((t.rank - 1) / (totalRanks - 1)) * chartH;

        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = MINT;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        if (i === 0 || i === timeline.length - 1 || t.rank <= 3) {
            ctx.fillStyle = CHARCOAL;
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('#' + t.rank, x, y - 8);
        }
    });

    // Axes
    ctx.strokeStyle = CHARCOAL;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + chartH);
    ctx.lineTo(900 - PAD.right, PAD.top + chartH);
    ctx.stroke();
}
