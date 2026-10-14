let rawDataP1 = [], rawDataP2 = [];
let colIdxP1 = {}, colIdxP2 = {};
let activeFilteredP1 = [], activeFilteredP2 = [];
let GLOBAL_DATES = [];
let masterHubData = [];
let currentCohortPill = 'All';

let currentPage = 'p1';
let activeTabCol = 'Vendor_Name';
let activeTabName = 'Vendor Name';
let activeTabTarget = 'vendor';

let currentProgress = 0;
let progressTimer = setInterval(() => {
  if (currentProgress < 85) {
    currentProgress += Math.floor(Math.random() * 5) + 1;
    if (currentProgress > 85) currentProgress = 85;
    $('#loader-percent').text(currentProgress + '%');
  }
}, 300);

const SAFE_DOM = '<"row"<"col-12"Q>><"row align-items-end"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rt<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>';

const calcPct = (n, d) => d ? (n / d) * 100 : 0;

const LOSS_REMARK_SEQ = {
  "Instock": 0, "NPD": 1, "NO-PO|NO-QOH| NO-IRN": 2, 
  "Not Received 30D(sch)": 3, "Not Received 30D": 4, "ASP Drop": 5, "Network Issue": 6, "Wrong Forecasting": 7, 
  "ATP-QOH Delta": 8, "No PO": 9, "PO Error": 10, "Not Enough PO Raised": 11,
  "Bad Fill Rate": 12, "Scheduled": 13, "Not Scheduled": 14, 
  "IWIT Pendency": 15, "SH-SH IWIT Issue": 16, "Other Loss": 17
};

const findCol = (colsObj, namesArray) => {
    for (let n of namesArray) {
        let target = n.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (let k in colsObj) {
            if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === target) return colsObj[k];
        }
    }
    return undefined;
};

$(document).on('click', 'tr.group-header', function() {
    let zoneSafe = $(this).data('zone');
    let $wrapper = $(this).closest('.dataTables_wrapper');
    let $children = $wrapper.find('tr.child-of-' + zoneSafe);
    if ($(this).hasClass('collapsed')) { $(this).removeClass('collapsed'); $children.show(); } 
    else { $(this).addClass('collapsed'); $children.hide(); }
    let tableId = $wrapper.find('table.dataTable').attr('id');
    if (tableId && $.fn.DataTable.isDataTable('#' + tableId)) {
        setTimeout(() => { $('#' + tableId).DataTable().fixedColumns().relayout(); }, 50);
    }
});

function renderGroupCol(d, type, row) {
    if (type !== 'display') return d;
    let content = d;
    if (row.isGroupHeader) content = `<i class="bi bi-chevron-down toggle-icon"></i><span>` + d + `</span>`;
    else if (row.isChild) content = `<span class="child-indent"></span>` + d;

    let rawText = d ? String(d).replace(/"/g, '&quot;') : '';
    return `<div style="max-width: 450px; min-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; vertical-align: middle; padding-right: 5px;" title="${rawText}">${content}</div>`;
}

function applyColorCoding(td, cellData, rowData) {
  if (rowData.isGrandTotal || rowData.isGroupHeader) return; 
  let pct = cellData; 
  if (pct < 60) { td.style.backgroundColor = '#fee2e2'; td.style.color = '#b91c1c'; } 
  else if (pct < 80) { td.style.backgroundColor = '#fef08a'; td.style.color = '#854d0e'; } 
  else { td.style.backgroundColor = '#dcfce7'; td.style.color = '#15803d'; }
}

$(document).ready(function() {
  $('.select2').select2({ width: '100%', placeholder: 'All' });
  
  google.script.run
    .withSuccessHandler(downloadCSVsFromDrive)
    .withFailureHandler(err => { alert("Config fetch failed."); clearInterval(progressTimer); $('#loader-overlay').hide(); })
    .getDriveDataConfig([0]);
    
  google.script.run
    .withSuccessHandler(renderHubDirectory)
    .getHubDirectory();

  $('.custom-tab').on('click', function (e) {
    e.preventDefault();
    $('.custom-tab').removeClass('active'); 
    $(this).addClass('active');
    activeTabTarget = $(this).data('target'); 
    activeTabCol = $(this).data('col'); 
    activeTabName = $(this).data('name');
    $('.tab-pane-custom').addClass('d-none').removeClass('active');
    $('#view-' + activeTabTarget).removeClass('d-none').addClass('active');
    renderVisibleTable();
  });
});

function applyDayChunks() {
  let selectedChunks = [];
  $('.chunk-checkbox:checked').each(function() {
      selectedChunks.push(parseInt($(this).val()));
  });

  if (selectedChunks.length === 0) {
      alert("Please select at least one day range.");
      $('#btn-chunk-0').prop('checked', true);
      selectedChunks = [0];
  } else if (selectedChunks.length > 3) {
      alert("Please select a maximum of 3 tabs at a time to prevent browser crashes.");
      return; 
  }

  $('#loader-text').text("Fetching Selected Days...");
  $('#loader-percent').text('0%');
  currentProgress = 0;
  $('#loader-overlay').show();

  rawDataP1 = []; rawDataP2 = []; 
  activeFilteredP1 = []; activeFilteredP2 = [];
  GLOBAL_DATES = [];

  google.script.run
    .withSuccessHandler(downloadCSVsFromDrive)
    .withFailureHandler(err => { alert("File Split fetch failed."); $('#loader-overlay').hide(); })
    .getDriveDataConfig(selectedChunks);
}

function toggleFullScreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else if (document.exitFullscreen) document.exitFullscreen();
}

function downloadCSVsFromDrive(config) {
  let p1Promise = fetchCSV(config.id1, config.token).then(data => { 
      currentProgress = Math.max(currentProgress, 40); 
      $('#loader-percent').text(currentProgress + '%'); 
      $('#loader-text').text("Parsing Loss Tree..."); 
      return data; 
  });

  let p2Promises = config.id2_array.map(id => fetchCSV(id, config.token));

  Promise.all([p1Promise, Promise.all(p2Promises)]).then(([data1, data2Array]) => { 
      clearInterval(progressTimer); 
      $('#loader-percent').text('95%'); 
      $('#loader-text').text("Building Dashboard...");

      let data2 = [];
      let baseHeaders = [];
      
      data2Array.forEach((chunkData, index) => {
        if (chunkData && chunkData.length > 0) {
          if (index === 0) {
            baseHeaders = chunkData[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
            data2 = data2.concat(chunkData); 
          } else {
            let chunkHeaders = chunkData[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
            let indexMap = baseHeaders.map(bh => chunkHeaders.indexOf(bh));
            
            let chunkWithoutHeader = chunkData.slice(1).map(row => {
               return indexMap.map(idx => idx > -1 ? row[idx] : "");
            });
            data2 = data2.concat(chunkWithoutHeader);
          }
        }
      });

      setTimeout(() => { 
          initDashboardFromClient(data1, data2); 
          $('#loader-percent').text('100%'); 
          setTimeout(() => { $('#loader-overlay').fadeOut(400); }, 300); 
      }, 50);
  }).catch(err => { 
      console.error(err); 
      alert("Error parsing CSV data. The file might be missing or too large."); 
      clearInterval(progressTimer); 
      $('#loader-overlay').hide(); 
  });
}

function fetchCSV(fileId, token) {
  return new Promise((resolve, reject) => {
    Papa.parse('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
      download: true, header: false, skipEmptyLines: true, worker: true, 
      downloadRequestHeaders: { "Authorization": "Bearer " + token },
      complete: function(results) { resolve(results.data); }, error: function(err) { reject(err); }
    });
  });
}

function initDashboardFromClient(d1, d2) {
  try {
    if (!d1 || d1.length === 0) d1 = [["Error"]];
    if (!d2 || d2.length === 0) d2 = [["Error"]];
    let headers1 = d1.shift(); 
    let headers2 = d2.shift();
    
    colIdxP1 = Object.fromEntries(headers1.map((h, i) => [h, i])); 
    colIdxP2 = Object.fromEntries(headers2.map((h, i) => [h, i])); 
    
    rawDataP1 = d1;
    
    const dateColIdx = findCol(colIdxP2, ['Report_Date']);
    if (dateColIdx !== undefined) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      d2 = d2.map(row => {
        if(row[dateColIdx]) {
          let dateStr = String(row[dateColIdx]); 
          let parts = dateStr.split(' ')[0].split('T')[0].split('-');
          if (parts.length === 3) row[dateColIdx] = `${parts[2]} ${months[parseInt(parts[1], 10) - 1]}`;
        } return row;
      });
    }
    
    rawDataP2 = d2;
    if(dateColIdx !== undefined) {
        GLOBAL_DATES = [...new Set(rawDataP2.map(r => String(r[dateColIdx] || 'Unknown')))];
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        GLOBAL_DATES.sort((a, b) => {
            if (a === 'Unknown') return -1; if (b === 'Unknown') return 1;
            let pA = a.split(' '), pB = b.split(' ');
            if (pA.length === 2 && pB.length === 2) return (monthNames.indexOf(pA[1]) * 100 + parseInt(pA[0], 10)) - (monthNames.indexOf(pB[1]) * 100 + parseInt(pB[0], 10));
            return a.localeCompare(b);
        });
    }
    populateFilterOptions(); triggerFilterLogic(); 
  } catch(e) { console.error("Init Error:", e); }
}

function renderHubDirectory(data) {
  masterHubData = data;
  const cohorts = new Set();
  data.forEach(d => { if(d.cohort && d.cohort !== 'Error') cohorts.add(d.cohort); });
  
  let pillsHtml = `<button class="hub-pill active" onclick="filterHubByCohort('All')">All</button>`;
  Array.from(cohorts).sort().forEach(c => {
    pillsHtml += `<button class="hub-pill" onclick="filterHubByCohort('${c.replace(/'/g, "\\'")}')">${c}</button>`;
  });
  $('#hub-pills-container').html(pillsHtml);
  displayHubGrid(masterHubData);
}

function filterHubByCohort(cohort) {
  currentCohortPill = cohort;
  $('#hub-pills-container .hub-pill').removeClass('active');
  $(`#hub-pills-container .hub-pill`).filter(function() { return $(this).text() === cohort; }).addClass('active');
  filterHub();
}

function displayHubGrid(data) {
  if(!data || data.length === 0) {
    $('#hub-grid').html('<div class="col-12 text-center text-muted py-5 mt-4"><i class="bi bi-folder-x fs-1"></i><p class="mt-2 fw-bold">No dashboard links found.</p></div>');
    return;
  }
  let html = '';
  data.forEach(item => {
    let badgeClass = 'bg-secondary', icon = 'bi-link-45deg';
    let typeLower = (item.type || '').toLowerCase();
    if (typeLower.includes('dashboard')) { badgeClass = 'hub-badge-dashboard'; icon = 'bi-bar-chart-line-fill'; }
    else if (typeLower.includes('tracker') || typeLower.includes('sheet')) { badgeClass = 'hub-badge-tracker'; icon = 'bi-file-earmark-spreadsheet-fill'; }
    else if (typeLower.includes('raw') || typeLower.includes('data')) { badgeClass = 'hub-badge-data'; icon = 'bi-database-fill'; }
    else if (typeLower.includes('error')) { badgeClass = 'bg-danger text-white'; icon = 'bi-exclamation-triangle-fill'; }
    
    html += `
      <div class="col-md-6 col-xl-4 hub-item">
        <a href="${item.link}" target="_blank" class="text-decoration-none">
          <div class="card hub-card-hz shadow-sm">
            <div class="d-flex align-items-center p-3">
              <div class="hub-icon-box me-3">
                <i class="bi ${icon} fs-2"></i>
              </div>
              <div class="flex-grow-1">
                <div class="d-flex justify-content-between align-items-start mb-1">
                  <h6 class="text-dark fw-bold mb-0">${item.name}</h6>
                  <span class="badge ${badgeClass} ms-2" style="font-size: 0.65rem;">${item.type || 'Link'}</span>
                </div>
                <p class="text-muted mb-0 lh-base" style="font-size: 0.85rem; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;">${item.desc}</p>
              </div>
            </div>
          </div>
        </a>
      </div>`;
  });
  $('#hub-grid').html(html);
}

function filterHub() {
  let q = $('#hub-search').val().toLowerCase();
  let filtered = masterHubData.filter(d => {
    let matchesSearch = (d.name||'').toLowerCase().includes(q) || (d.desc||'').toLowerCase().includes(q) || (d.type||'').toLowerCase().includes(q);
    let matchesCohort = currentCohortPill === 'All' || d.cohort === currentCohortPill;
    return matchesSearch && matchesCohort;
  });
  displayHubGrid(filtered);
}

function togglePage() {
  if ($('#btn-p0').is(':checked')) currentPage = 'p0';
  else if ($('#btn-p1').is(':checked')) currentPage = 'p1';
  else if ($('#btn-p2').is(':checked')) currentPage = 'p2';
  else if ($('#btn-p3').is(':checked')) currentPage = 'p3';
  else currentPage = 'hub';

  if (currentPage === 'p2' || currentPage === 'p3') {
    $('#day-range-toggles').removeClass('d-none');
  } else {
    $('#day-range-toggles').addClass('d-none');
  }

  if (currentPage === 'hub') {
    $('#filter-card').slideUp(200);
    $('#tabs-wrapper').addClass('d-none');
    $('#summary-wrapper').addClass('d-none');
    $('#deep-dive-wrapper').addClass('d-none');
    $('#hub-wrapper').removeClass('d-none');
    return;
  } else {
    $('#filter-card').slideDown(200);
    $('#hub-wrapper').addClass('d-none');
    $('#tabs-wrapper').removeClass('d-none');
  }

  if (currentPage === 'p0') {
    $('#tabs-wrapper').addClass('d-none');
    $('#deep-dive-wrapper').addClass('d-none');
    $('#summary-wrapper').removeClass('d-none');
  } else {
    $('#tabs-wrapper').removeClass('d-none');
    $('#summary-wrapper').addClass('d-none');
    $('#deep-dive-wrapper').removeClass('d-none');
    $('.p1-container, .p2-container, .p3-container').addClass('d-none');
    if (currentPage === 'p1') { $('.p1-container').removeClass('d-none'); $('.text-muted.p2-container').addClass('d-none'); } 
    else if (currentPage === 'p2') { $('.p2-container').removeClass('d-none'); $('.text-muted.p2-container').removeClass('d-none'); } 
    else { $('.p3-container').removeClass('d-none'); $('.text-muted.p2-container').addClass('d-none'); }
  }
  renderVisibleTable();
}

function checkFiltersApplied() {
  return $('#filter-bu').val().length > 0 || $('#filter-company').val().length > 0 || 
         $('#filter-kam').val().length > 0 || $('#filter-kam-lead').val().length > 0 || 
         $('#filter-sh').val().length > 0 || $('#filter-owner').val().length > 0 || 
         $('#filter-brand').val().length > 0 || $('#filter-vendor').val().length > 0 || 
         $('#filter-vertical').val().length > 0 || $('#filter-tagging').val().length > 0 || 
         $('#filter-vmi').val().length > 0 || $('#filter-brand-poc').val().length > 0 ||
         $('#filter-fsn').val().length > 0 || $('#filter-buying-node').val().length > 0 ||
         $('#filter-ds-bucket').val().length > 0 || $('#filter-zone').val().length > 0 ||
         $('#filter-updated-bu').val().length > 0 || $('#filter-gourmet').val().length > 0 || 
         $('#filter-regional').val().length > 0 || $('#filter-supercategory').val().length > 0 ||
         $('#filter-organic').val().length > 0 || $('#filter-em').val().length > 0 || $('#filter-ubpl').val().length > 0;
}

function triggerFilterLogic() {
  $('#loader-percent').text(''); $('#loader-text').text("Applying Filters..."); $('#loader-overlay').show();
  setTimeout(function() { try { aggregateAllDataInMemory(); renderVisibleTable(); } catch (e) { console.error("Filter Error: ", e); } finally { $('#loader-overlay').fadeOut(200); } }, 50);
}

function aggregateAllDataInMemory() {
  const filterSets = {
    bu: new Set($('#filter-bu').val() || []), company: new Set($('#filter-company').val() || []), kam: new Set($('#filter-kam').val() || []),
    kamLead: new Set($('#filter-kam-lead').val() || []), owner: new Set($('#filter-owner').val() || []), sh: new Set($('#filter-sh').val() || []),
    brand: new Set($('#filter-brand').val() || []), vendor: new Set($('#filter-vendor').val() || []), vertical: new Set($('#filter-vertical').val() || []),
    supercategory: new Set($('#filter-supercategory').val() || []),
    tagging: new Set($('#filter-tagging').val() || []), vmi: new Set($('#filter-vmi').val() || []), brandPoc: new Set($('#filter-brand-poc').val() || []),
    fsn: new Set($('#filter-fsn').val() || []), dsBucket: new Set($('#filter-ds-bucket').val() || []), zone: new Set($('#filter-zone').val() || []),
    updatedBu: new Set($('#filter-updated-bu').val() || []), gourmet: new Set($('#filter-gourmet').val() || []), regional: new Set($('#filter-regional').val() || []),
    organic: new Set($('#filter-organic').val() || []), em: new Set($('#filter-em').val() || []), ubpl: new Set($('#filter-ubpl').val() || [])
  };

  let idxBU1 = findCol(colIdxP1, ['BU']); let idxComp1 = findCol(colIdxP1, ['Company']); let idxKam1 = findCol(colIdxP1, ['KAM']); let idxLead1 = findCol(colIdxP1, ['KAM_Lead']); let idxOwner1 = findCol(colIdxP1, ['Instock_Owner']);
  let idxSH1 = findCol(colIdxP1, ['FC_Code']); let idxBrand1 = findCol(colIdxP1, ['brand']); let idxVendor1 = findCol(colIdxP1, ['Vendor_Name']); let idxVert1 = findCol(colIdxP1, ['analytic_vertical']); let idxTag1 = findCol(colIdxP1, ['tagging']);
  let idxVmi1 = findCol(colIdxP1, ['VMI_Flag', 'vmi']); let idxBrandPoc1 = findCol(colIdxP1, ['brand_poc', 'brandpoc']); let idxFsn1 = findCol(colIdxP1, ['FSN', 'fsn']);
  let idxBuyNode1 = findCol(colIdxP1, ['Buying_Node_Flag']); let idxDsBucket1 = findCol(colIdxP1, ['Instock_DS_Bucket', 'instockdsbucket']); let idxZone1 = findCol(colIdxP1, ['Zone']);
  let idxUpdatedBu1 = findCol(colIdxP1, ['Updated_BU']); let idxGourmet1 = findCol(colIdxP1, ['Gourmet_Flag', 'gourmet']); let idxRegional1 = findCol(colIdxP1, ['Regional_fsn_flag', 'regionalfsn']);
  let idxSuper1 = findCol(colIdxP1, ['Super_Category', 'supercategory']); let idxOrg1 = findCol(colIdxP1, ['Organic_Flag', 'organic']); let idxEm1 = findCol(colIdxP1, ['Engagement_Manager', 'engagementmanager']); let idxUbpl1 = findCol(colIdxP1, ['UB_PL_Flag', 'ubpl', 'ub_pl']);

  activeFilteredP1 = rawDataP1.filter(row => {
    let buyNode = idxBuyNode1 !== undefined ? String(row[idxBuyNode1] || '').trim().toLowerCase() : 'yes';
    let mappedBnFilters = ($('#filter-buying-node').val() || []).map(v => String(v).toLowerCase().trim());
    if (mappedBnFilters.length > 0 && !mappedBnFilters.includes(buyNode)) return false;
    if (filterSets.dsBucket.size > 0 && idxDsBucket1 !== undefined && !filterSets.dsBucket.has(String(row[idxDsBucket1]).trim())) return false;
    if (filterSets.zone.size > 0 && idxZone1 !== undefined && !filterSets.zone.has(String(row[idxZone1]).trim())) return false;
    if (filterSets.updatedBu.size > 0 && idxUpdatedBu1 !== undefined && !filterSets.updatedBu.has(String(row[idxUpdatedBu1]).trim())) return false;
    if (filterSets.gourmet.size > 0 && idxGourmet1 !== undefined && !filterSets.gourmet.has(String(row[idxGourmet1]).trim())) return false;
    if (filterSets.regional.size > 0 && idxRegional1 !== undefined && !filterSets.regional.has(String(row[idxRegional1]).trim())) return false;
    if (filterSets.organic.size > 0 && idxOrg1 !== undefined && !filterSets.organic.has(String(row[idxOrg1]).trim())) return false;
    if (filterSets.em.size > 0 && idxEm1 !== undefined && !filterSets.em.has(String(row[idxEm1]).trim())) return false;
    if (filterSets.ubpl.size > 0 && idxUbpl1 !== undefined && !filterSets.ubpl.has(String(row[idxUbpl1]).trim())) return false;
    
    if (filterSets.bu.size > 0 && idxBU1 !== undefined && !filterSets.bu.has(String(row[idxBU1]).trim())) return false;
    if (filterSets.company.size > 0 && idxComp1 !== undefined && !filterSets.company.has(String(row[idxComp1]).trim())) return false;
    if (filterSets.kam.size > 0 && idxKam1 !== undefined && !filterSets.kam.has(String(row[idxKam1]).trim())) return false;
    if (filterSets.kamLead.size > 0 && idxLead1 !== undefined && !filterSets.kamLead.has(String(row[idxLead1]).trim())) return false;
    if (filterSets.owner.size > 0 && idxOwner1 !== undefined && !filterSets.owner.has(String(row[idxOwner1]).trim())) return false;
    if (filterSets.sh.size > 0 && idxSH1 !== undefined && !filterSets.sh.has(String(row[idxSH1]).trim())) return false;
    if (filterSets.brand.size > 0 && idxBrand1 !== undefined && !filterSets.brand.has(String(row[idxBrand1]).trim())) return false;
    if (filterSets.vendor.size > 0 && idxVendor1 !== undefined && !filterSets.vendor.has(String(row[idxVendor1]).trim())) return false;
    if (filterSets.vertical.size > 0 && idxVert1 !== undefined && !filterSets.vertical.has(String(row[idxVert1]).trim())) return false;
    if (filterSets.supercategory.size > 0 && idxSuper1 !== undefined && !filterSets.supercategory.has(String(row[idxSuper1]).trim())) return false;
    if (filterSets.tagging.size > 0 && idxTag1 !== undefined && !filterSets.tagging.has(String(row[idxTag1]).trim())) return false;
    if (filterSets.vmi.size > 0 && idxVmi1 !== undefined && !filterSets.vmi.has(String(row[idxVmi1]).trim())) return false;
    if (filterSets.brandPoc.size > 0 && idxBrandPoc1 !== undefined && !filterSets.brandPoc.has(String(row[idxBrandPoc1]).trim())) return false;
    if (filterSets.fsn.size > 0 && idxFsn1 !== undefined && !filterSets.fsn.has(String(row[idxFsn1]).trim())) return false;
    return true;
  });

  let idxBU2 = findCol(colIdxP2, ['BU']), idxComp2 = findCol(colIdxP2, ['Company']), idxKam2 = findCol(colIdxP2, ['KAM']), idxLead2 = findCol(colIdxP2, ['KAM_Lead']), idxOwner2 = findCol(colIdxP2, ['Instock_Owner']);
  let idxSH2 = findCol(colIdxP2, ['FC_Code']), idxBrand2 = findCol(colIdxP2, ['brand']), idxVendor2 = findCol(colIdxP2, ['Vendor_Name']), idxVert2 = findCol(colIdxP2, ['analytic_vertical']), idxTag2 = findCol(colIdxP2, ['tagging']);
  let idxVmi2 = findCol(colIdxP2, ['VMI_Flag', 'vmi']), idxBrandPoc2 = findCol(colIdxP2, ['brand_poc', 'brandpoc']), idxFsn2 = findCol(colIdxP2, ['FSN', 'fsn']), idxBuyNode2 = findCol(colIdxP2, ['Buying_Node_Flag']);
  let idxDsBucket2 = findCol(colIdxP2, ['Instock_DS_Bucket', 'instockdsbucket']), idxZone2 = findCol(colIdxP2, ['Zone']);
  let idxUpdatedBu2 = findCol(colIdxP2, ['Updated_BU']), idxGourmet2 = findCol(colIdxP2, ['Gourmet_Flag', 'gourmet']), idxRegional2 = findCol(colIdxP2, ['Regional_fsn_flag', 'regionalfsn']);
  let idxSuper2 = findCol(colIdxP2, ['Super_Category', 'supercategory']), idxOrg2 = findCol(colIdxP2, ['Organic_Flag', 'organic']), idxEm2 = findCol(colIdxP2, ['Engagement_Manager', 'engagementmanager']), idxUbpl2 = findCol(colIdxP2, ['UB_PL_Flag', 'ubpl', 'ub_pl']);

  activeFilteredP2 = rawDataP2.filter(row => {
    let buyNode = idxBuyNode2 !== undefined ? String(row[idxBuyNode2] || '').trim().toLowerCase() : 'yes';
    let mappedBnFilters = ($('#filter-buying-node').val() || []).map(v => String(v).toLowerCase().trim());
    if (mappedBnFilters.length > 0 && !mappedBnFilters.includes(buyNode)) return false;
    if (filterSets.dsBucket.size > 0 && idxDsBucket2 !== undefined && !filterSets.dsBucket.has(String(row[idxDsBucket2]).trim())) return false;
    if (filterSets.zone.size > 0 && idxZone2 !== undefined && !filterSets.zone.has(String(row[idxZone2]).trim())) return false;
    if (filterSets.updatedBu.size > 0 && idxUpdatedBu2 !== undefined && !filterSets.updatedBu.has(String(row[idxUpdatedBu2]).trim())) return false;
    if (filterSets.gourmet.size > 0 && idxGourmet2 !== undefined && !filterSets.gourmet.has(String(row[idxGourmet2]).trim())) return false;
    if (filterSets.regional.size > 0 && idxRegional2 !== undefined && !filterSets.regional.has(String(row[idxRegional2]).trim())) return false;
    if (filterSets.organic.size > 0 && idxOrg2 !== undefined && !filterSets.organic.has(String(row[idxOrg2]).trim())) return false;
    if (filterSets.em.size > 0 && idxEm2 !== undefined && !filterSets.em.has(String(row[idxEm2]).trim())) return false;
    if (filterSets.ubpl.size > 0 && idxUbpl2 !== undefined && !filterSets.ubpl.has(String(row[idxUbpl2]).trim())) return false;

    if (filterSets.bu.size > 0 && idxBU2 !== undefined && !filterSets.bu.has(String(row[idxBU2]).trim())) return false;
    if (filterSets.company.size > 0 && idxComp2 !== undefined && !filterSets.company.has(String(row[idxComp2]).trim())) return false;
    if (filterSets.kam.size > 0 && idxKam2 !== undefined && !filterSets.kam.has(String(row[idxKam2]).trim())) return false;
    if (filterSets.kamLead.size > 0 && idxLead2 !== undefined && !filterSets.kamLead.has(String(row[idxLead2]).trim())) return false;
    if (filterSets.owner.size > 0 && idxOwner2 !== undefined && !filterSets.owner.has(String(row[idxOwner2]).trim())) return false;
    if (filterSets.sh.size > 0 && idxSH2 !== undefined && !filterSets.sh.has(String(row[idxSH2]).trim())) return false;
    if (filterSets.brand.size > 0 && idxBrand2 !== undefined && !filterSets.brand.has(String(row[idxBrand2]).trim())) return false;
    if (filterSets.vendor.size > 0 && idxVendor2 !== undefined && !filterSets.vendor.has(String(row[idxVendor2]).trim())) return false;
    if (filterSets.vertical.size > 0 && idxVert2 !== undefined && !filterSets.vertical.has(String(row[idxVert2]).trim())) return false;
    if (filterSets.supercategory.size > 0 && idxSuper2 !== undefined && !filterSets.supercategory.has(String(row[idxSuper2]).trim())) return false;
    if (filterSets.tagging.size > 0 && idxTag2 !== undefined && !filterSets.tagging.has(String(row[idxTag2]).trim())) return false;
    if (filterSets.vmi.size > 0 && idxVmi2 !== undefined && !filterSets.vmi.has(String(row[idxVmi2]).trim())) return false;
    if (filterSets.brandPoc.size > 0 && idxBrandPoc2 !== undefined && !filterSets.brandPoc.has(String(row[idxBrandPoc2]).trim())) return false;
    if (filterSets.fsn.size > 0 && idxFsn2 !== undefined && !filterSets.fsn.has(String(row[idxFsn2]).trim())) return false;
    return true;
  });
}

function renderVisibleTable() {
  if (currentPage === 'p0') {
    if ($.fn.DataTable.isDataTable('#dt-summary')) { $('#dt-summary').DataTable().clear().destroy(); $('#dt-summary').empty(); }
    if ($.fn.DataTable.isDataTable('#dt-summary-zone')) { $('#dt-summary-zone').DataTable().clear().destroy(); $('#dt-summary-zone').empty(); }
    if ($.fn.DataTable.isDataTable('#dt-summary-sh')) { $('#dt-summary-sh').DataTable().clear().destroy(); $('#dt-summary-sh').empty(); }
    
    buildSummaryTables('dt-summary', 'dt-summary-zone', 'dt-summary-sh', activeFilteredP1);
    
    setTimeout(() => { 
        if ($.fn.DataTable.isDataTable('#dt-summary')) { $('#dt-summary').DataTable().columns.adjust().draw(); try { $('#dt-summary').DataTable().fixedColumns().relayout(); } catch(e) {} }
        if ($.fn.DataTable.isDataTable('#dt-summary-zone')) { $('#dt-summary-zone').DataTable().columns.adjust().draw(); try { $('#dt-summary-zone').DataTable().fixedColumns().relayout(); } catch(e) {} }
        if ($.fn.DataTable.isDataTable('#dt-summary-sh')) { $('#dt-summary-sh').DataTable().columns.adjust().draw(); try { $('#dt-summary-sh').DataTable().fixedColumns().relayout(); } catch(e) {} }
    }, 250);
    return;
  }

  if (activeTabTarget === 'fsn') {
    if (!checkFiltersApplied()) {
      $('#fsn-guardrail').removeClass('d-none'); $('.fsn-tables-wrapper').addClass('d-none');
      return; 
    } else {
      $('#fsn-guardrail').addClass('d-none'); $('.fsn-tables-wrapper').removeClass('d-none');
    }
  }

  let targetId = 'dt-' + activeTabTarget + '-' + currentPage;
  if ($.fn.DataTable.isDataTable('#' + targetId)) {
      $('#' + targetId).DataTable().clear().destroy();
      $('#' + targetId).empty();
  }

  if (currentPage === 'p1') buildTableP1(targetId, activeFilteredP1, activeTabCol, activeTabName);
  else if (currentPage === 'p2') buildTableP2(targetId, activeFilteredP2, activeTabCol, activeTabName);
  else buildTableP3(targetId, activeFilteredP2, activeTabCol, activeTabName);
  
  setTimeout(() => { 
      if ($.fn.DataTable.isDataTable('#' + targetId)) {
          $('#' + targetId).DataTable().columns.adjust().draw();
          try { $('#' + targetId).DataTable().fixedColumns().relayout(); } catch(e) {}
      }
  }, 250);
}

// RESTORED SUMMARY TABLE WITH CORRECT ROW FORMATTER
function buildSummaryTables(tableIdMain, tableIdZone, tableIdSH, data) {
  try {
    const byGroup = {}; const byZoneTag = {}; const zoneTotals = {}; const shTotals = {}; const byShTag = {};
    let gt = { fsn: 0, atp: 0, qoh: 0, openPo: 0, fdrr: 0, sdrr: 0, dsInstock: 0, dsTotal: 0, shInstock: 0, shSch: 0, shPo: 0, mstnAtp: 0, mstnSch: 0, mstnPo: 0, norm: 0, iwit: 0, irn: 0, dsMstn: 0, dsMstnIt: 0, dsNorm: 0, instockItDs: 0, dsNormRaw: 0 };

    let idxTag = findCol(colIdxP1, ['tagging']); let idxZone = findCol(colIdxP1, ['Zone']); let idxSH = findCol(colIdxP1, ['FC_Code']);
    let idxFsn = findCol(colIdxP1, ['FSN_Count']); let idxAtp = findCol(colIdxP1, ['ATP_Current']); let idxQoh = findCol(colIdxP1, ['QOH']);
    let idxOpenPo = findCol(colIdxP1, ['Open_PO']); let idxFdrr = findCol(colIdxP1, ['Total_rolled_fdrr']); let idxSdrr = findCol(colIdxP1, ['DRR_7D']);
    let idxDsIn = findCol(colIdxP1, ['Instock_DS_Count']); let idxDsTot = findCol(colIdxP1, ['Total_DS_Count']); let idxMstnAtp = findCol(colIdxP1, ['MSTN_atp']);
    let idxMstnSch = findCol(colIdxP1, ['MSTN_with_scheduling']); let idxMstnPo  = findCol(colIdxP1, ['MSTN_with_po']); let idxNorm    = findCol(colIdxP1, ['new_norm']);
    let idxDoh = findCol(colIdxP1, ['ATP_DOH_Bucket']); let idxSchedDoh = findCol(colIdxP1, ['ATP_Sched_DOH_Bucket']); let idxPoDoh = findCol(colIdxP1, ['ATP_PO_DOH_Bucket']);
    let bnIdx = findCol(colIdxP1, ['Buying_Node_Flag']); let idxIwit = findCol(colIdxP1, ['SH_DS_IWIT_T_minus_1']); let idxIrn = findCol(colIdxP1, ['IRN_T_minus_2']);
    let idxDsMstn = findCol(colIdxP1, ['DS_MSTN']); let idxDsMstnIt = findCol(colIdxP1, ['DS_MSTN_IT']); let idxDsNorm = findCol(colIdxP1, ['DS_Norm']);
    let idxInstockItDs = findCol(colIdxP1, ['Instock_IT_DS_Count']);

    let bnFiltersRaw = $('#filter-buying-node').val() || [];
    let mappedBnFilters = bnFiltersRaw.map(v => String(v).toLowerCase().trim());
    let taggingFiltersRaw = $('#filter-tagging').val() || [];

    const initBucket = () => ({ fsn: 0, atp: 0, qoh: 0, openPo: 0, fdrr: 0, sdrr: 0, dsInstock: 0, dsTotal: 0, shInstock: 0, shSch: 0, shPo: 0, mstnAtp: 0, mstnSch: 0, mstnPo: 0, norm: 0, iwit: 0, irn: 0, dsMstn: 0, dsMstnIt: 0, dsNorm: 0, instockItDs: 0, dsNormRaw: 0 });

    for (let i = 0; i < data.length; i++) {
      let row = data[i];
      const groupKey = (idxTag !== undefined && row[idxTag] ? row[idxTag] : 'Unknown').toString().trim();
      const zoneName = (idxZone !== undefined && row[idxZone] ? row[idxZone] : 'Unassigned').toString().trim();
      const shName = (idxSH !== undefined && row[idxSH] ? row[idxSH] : 'Unknown').toString().trim();

      if (taggingFiltersRaw.length === 0) {
          let tagNorm = groupKey.toLowerCase().replace(/\s+/g, '');
          if (tagNorm.includes('rest')) continue; 
      }

      const buyNode = bnIdx !== undefined ? String(row[bnIdx] || '').trim().toLowerCase() : 'yes';
      
      let isAllowedSH = false; let isAllowedDS = false;
      if (bnFiltersRaw.length === 0) { isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true'); isAllowedDS = true; } 
      else { let matchesFilter = mappedBnFilters.includes(buyNode); isAllowedSH = matchesFilter; isAllowedDS = matchesFilter; }

      if (!byGroup[groupKey]) byGroup[groupKey] = initBucket();
      if (!zoneTotals[zoneName]) zoneTotals[zoneName] = initBucket();
      let ztKey = zoneName + "|||" + groupKey;
      if (!byZoneTag[ztKey]) byZoneTag[ztKey] = initBucket();

      if (!shTotals[shName]) shTotals[shName] = initBucket();
      let shTagKey = shName + "|||" + groupKey;
      if (!byShTag[shTagKey]) byShTag[shTagKey] = initBucket();
      
      let vFsn = Number(row[idxFsn]) || 0;

      if (isAllowedDS) {
          let vDsIn = Number(row[idxDsIn]) || 0;
          let vDsTot = Number(row[idxDsTot]) || 0;
          let vDsMstn = Number(row[idxDsMstn]) || 0, vDsMstnIt = Number(row[idxDsMstnIt]) || 0, vDsNorm = Number(row[idxDsNorm]) || 0, vInstockItDs = Number(row[idxInstockItDs]) || 0;
          
          let addDsMetrics = (b) => {
              b.dsInstock += vDsIn; b.dsTotal += vDsTot; b.dsMstn += vDsMstn; b.dsMstnIt += vDsMstnIt; b.dsNorm += vDsNorm; b.instockItDs += vInstockItDs; b.dsNormRaw += vDsNorm;
          };
          addDsMetrics(byGroup[groupKey]); addDsMetrics(zoneTotals[zoneName]); addDsMetrics(byZoneTag[ztKey]);
          addDsMetrics(shTotals[shName]); addDsMetrics(byShTag[shTagKey]); addMetrics(gt);
      }

      if (isAllowedSH) {
          let vAtp = Number(row[idxAtp]) || 0, vQoh = Number(row[idxQoh]) || 0, vOpenPo = Number(row[idxOpenPo]) || 0;
          let vFdrr = Number(row[idxFdrr]) || 0, vSdrr = Number(row[idxSdrr]) || 0;
          let vMstnAtp = Number(row[idxMstnAtp]) || 0, vMstnSch = Number(row[idxMstnSch]) || 0, vMstnPo = Number(row[idxMstnPo]) || 0, vNorm = Number(row[idxNorm]) || 0;
          let vIwit = idxIwit !== undefined ? (Number(row[idxIwit]) || 0) : 0;
          let vIrn = idxIrn !== undefined ? (Number(row[idxIrn]) || 0) : 0;
          let bDoh = (idxDoh !== undefined && row[idxDoh] ? row[idxDoh] : '').toString().trim().toUpperCase();
          let bSchedDoh = (idxSchedDoh !== undefined && row[idxSchedDoh] ? row[idxSchedDoh] : '').toString().trim().toUpperCase();
          let bPoDoh = (idxPoDoh !== undefined && row[idxPoDoh] ? row[idxPoDoh] : '').toString().trim().toUpperCase();

          let isShIn = (bDoh !== '' && bDoh !== '<2DOH') ? vFsn : 0;
          let isShSch = (bSchedDoh !== '' && bSchedDoh !== '<2DOH') ? vFsn : 0;
          let isShPo = (bPoDoh !== '' && bPoDoh !== '<2DOH') ? vFsn : 0;

          let addMetrics = (b) => {
              b.fsn += vFsn; b.atp += vAtp; b.qoh += vQoh; b.openPo += vOpenPo; b.fdrr += vFdrr; b.sdrr += vSdrr;
              b.shInstock += isShIn; b.shSch += isShSch; b.shPo += isShPo;
              b.mstnAtp += vMstnAtp; b.mstnSch += vMstnSch; b.mstnPo += vMstnPo; b.norm += vNorm;
              b.iwit += vIwit; b.irn += vIrn;
          };
          addMetrics(byGroup[groupKey]); addMetrics(zoneTotals[zoneName]); addMetrics(byZoneTag[ztKey]);
          addMetrics(shTotals[shName]); addMetrics(byShTag[shTagKey]); addMetrics(gt);
      }
    }

    const getSorter = (groupName) => {
      let gNorm = groupName.toLowerCase().replace(/\s+/g, '');
      if (gNorm.includes('top100')) return 1; if (gNorm.includes('101-500')) return 2; if (gNorm.includes('core')) return 3;
      if (gNorm.includes('next2500') || gNorm.includes('next2.5k')) return 4; if (gNorm.includes('7500') || gNorm.includes('7.5k')) return 5;
      if (gNorm.includes('10k') || gNorm.includes('10000')) return 6; if (gNorm.includes('rest')) return 7;
      return 99;
    };

    const formatRow = (r, sOrd, grp, isGT, isGrpHdr, isCh, zSafe) => ({
        is_gt: isGT ? 0 : 1, sort_order: sOrd, group: grp, isGrandTotal: isGT, isGroupHeader: isGrpHdr, isChild: isCh, zoneSafe: zSafe,
        fsn: r.fsn, atp: r.atp, qoh: r.qoh, openPo: r.openPo, fdrr: r.fdrr, sdrr: r.sdrr, iwit: r.iwit, irn: r.irn,
        dsNormRaw: r.dsNormRaw,
        dsPct: calcPct(r.dsInstock, r.dsTotal), dsInstockItPct: calcPct(r.instockItDs, r.dsTotal),
        shPct: calcPct(r.shInstock, r.fsn), shSchPct: calcPct(r.shSch, r.fsn), shPoPct: calcPct(r.shPo, r.fsn),
        dsMstnPct: calcPct(r.dsMstn, r.dsNorm), dsMstnItPct: calcPct(r.dsMstnIt, r.dsNorm),
        mstnAtpPct: calcPct(r.mstnAtp, r.norm), mstnSchPct: calcPct(r.mstnSch, r.norm), mstnPoPct: calcPct(r.mstnPo, r.norm)
    });

    const t1Data = [];
    if (gt.fsn > 0 || gt.dsTotal > 0) t1Data.push(formatRow(gt, 0, 'GRAND TOTAL', true, false, false, ''));
    Object.keys(byGroup).forEach(grp => t1Data.push(formatRow(byGroup[grp], getSorter(grp), grp, false, false, false, '')));

    const t2Data = [];
    if (gt.fsn > 0 || gt.dsTotal > 0) t2Data.push(formatRow(gt, 0, 'GRAND TOTAL', true, false, false, ''));
    Object.keys(zoneTotals).sort().forEach(z => {
        let zSafe = z.replace(/[^a-zA-Z0-9]/g, '');
        t2Data.push(formatRow(zoneTotals[z], 1, z, false, true, false, zSafe));
        let zoneChildren = [];
        Object.keys(byZoneTag).forEach(ztKey => {
            let parts = ztKey.split("|||");
            if (parts[0] === z) zoneChildren.push(formatRow(byZoneTag[ztKey], getSorter(parts[1]), parts[1], false, false, true, zSafe));
        });
        zoneChildren.sort((a, b) => a.sort_order - b.sort_order); zoneChildren.forEach(child => t2Data.push(child));
    });

    const t3Data = [];
    if (gt.fsn > 0 || gt.dsTotal > 0) t3Data.push(formatRow(gt, 0, 'GRAND TOTAL', true, false, false, ''));
    Object.keys(shTotals).sort().forEach(sh => {
        let shSafe = sh.replace(/[^a-zA-Z0-9]/g, '');
        t3Data.push(formatRow(shTotals[sh], 1, sh, false, true, false, shSafe));
        let shChildren = [];
        Object.keys(byShTag).forEach(shTagKey => {
            let parts = shTagKey.split("|||");
            if (parts[0] === sh) shChildren.push(formatRow(byShTag[shTagKey], getSorter(parts[1]), parts[1], false, false, true, shSafe));
        });
        shChildren.sort((a, b) => a.sort_order - b.sort_order); shChildren.forEach(child => t3Data.push(child));
    });

    let columns = [
      { title: "", data: 'is_gt', visible: false, searchable: false },
      { title: "", data: 'sort_order', visible: false, searchable: false },
      { title: "Tagging", data: 'group', orderData: [0, 1], render: renderGroupCol },
      { title: "FSN Count", data: 'fsn', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "Current ATP", data: 'atp', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "QoH", data: 'qoh', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "Open PO", data: 'openPo', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "Total Rolled FDRR", data: 'fdrr', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "SDRR (7D)", data: 'sdrr', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "DS Norm", data: 'dsNormRaw', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "DS Instock %", data: 'dsPct', type: 'num', className: 'section-divider', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "DS Instock+IT %", data: 'dsInstockItPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "SH Instock %", data: 'shPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "SH (+Sch) %", data: 'shSchPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "SH (+PO) %", data: 'shPoPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "DS MSTN %", data: 'dsMstnPct', type: 'num', className: 'section-divider', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "DS MSTN+IT %", data: 'dsMstnItPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "MSTN (ATP) %", data: 'mstnAtpPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "MSTN (+Sch) %", data: 'mstnSchPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "MSTN (+PO) %", data: 'mstnPoPct', type: 'num', render: function(d,t){ return t==='display'? d.toFixed(1)+'%' : d; }, createdCell: applyColorCoding },
      { title: "SH-DS IWIT (T-1)", data: 'iwit', type: 'num', className: 'section-divider', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "IRN (T-2)", data: 'irn', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) }
    ];

    const dtConfig = {
      columns: columns, deferRender: true, scrollX: true, scrollY: '50vh', scrollCollapse: true, 
      fixedColumns: { left: 1 }, dom: SAFE_DOM, searchBuilder: { logic: 'AND' }, autoWidth: false, 
      orderFixed: [0, 'asc'], order: [[1, 'asc']], paging: false, 
      createdRow: function (row, data) { 
          if (data.isGrandTotal) $(row).addClass('total-row'); 
          else if (data.isGroupHeader) { $(row).addClass('group-header'); $(row).attr('data-zone', data.zoneSafe); }
          else if (data.isChild) { $(row).addClass('child-row child-of-' + data.zoneSafe); }
      },
      drawCallback: function(settings) {
          var api = this.api(); var $body = $(api.table().body()); var parents = $body.find('tr.group-header');
          parents.each(function() {
              var zoneSafe = $(this).attr('data-zone'); var children = $body.find('tr.child-of-' + zoneSafe);
              if ($(this).hasClass('collapsed')) { children.hide(); } else { children.show(); } $(this).after(children);
          });
      }
    };

    $('#' + tableIdMain).DataTable({ ...dtConfig, data: t1Data });
    $('#' + tableIdZone).DataTable({ ...dtConfig, data: t2Data }); 
    $('#' + tableIdSH).DataTable({ ...dtConfig, data: t3Data }); 
  } catch (err) { console.error("Summary render error", err); }
}

function buildTableP1(tableId, data, groupCol, groupColName) {
  try {
    let isShLevel = (groupColName === 'SH (FC Code)');
    const byGroup = {}; const shToZone = {}; let grandTotalFsns = 0, grandTotalDSInstock = 0, grandTotalDSTotal = 0; let grandTotalRemarks = {};
    
    let gColIdx = findCol(colIdxP1, [groupCol]);
    let rIdx = findCol(colIdxP1, ['Loss_Remark']), fsnIdx = findCol(colIdxP1, ['FSN_Count']);
    let dsiIdx = findCol(colIdxP1, ['Instock_DS_Count']), dstIdx = findCol(colIdxP1, ['Total_DS_Count']), bnIdx = findCol(colIdxP1, ['Buying_Node_Flag']);
    let zIdx = findCol(colIdxP1, ['Zone']);
    let titleIdx = findCol(colIdxP1, ['Title', 'Product_Title']);

    let bnFiltersRaw = $('#filter-buying-node').val() || [];
    let mappedBnFilters = bnFiltersRaw.map(v => String(v).toLowerCase().trim());

    Object.keys(LOSS_REMARK_SEQ).forEach(k => grandTotalRemarks[k] = 0);
    for (let i = 0; i < data.length; i++) {
      let row = data[i];
      let groupKey = (gColIdx !== undefined && row[gColIdx] ? row[gColIdx] : 'Unknown').toString().trim();
      
      let finalGroupKey = groupKey;
      if (groupColName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel) shToZone[finalGroupKey] = zIdx !== undefined ? (row[zIdx] || 'Unassigned').toString().trim() : 'Unassigned';

      // EXACT LOSS REMARK MAPPER (Fixes ASP and Network 0% issue)
      const rawRemark = String(row[rIdx] || '').trim().toLowerCase();
      let remark = 'Other Loss';
      if (rawRemark.includes('asp')) remark = 'ASP Drop';
      else if (rawRemark.includes('network')) remark = 'Network Issue';
      else {
          for (let k of Object.keys(LOSS_REMARK_SEQ)) { 
              if (k.toLowerCase() === rawRemark) { remark = k; break; } 
          }
      }

      const fsns = Number(row[fsnIdx]) || 0;
      let dsInstock = Number(row[dsiIdx]) || 0;
      let dsTotal = Number(row[dstIdx]) || 0;
      
      const buyNode = bnIdx !== undefined ? String(row[bnIdx] || '').trim().toLowerCase() : 'yes';
      
      let isAllowedSH = false; let isAllowedDS = false;
      if (bnFiltersRaw.length === 0) { isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true'); isAllowedDS = true; } 
      else { let matchesFilter = mappedBnFilters.includes(buyNode); isAllowedSH = matchesFilter; isAllowedDS = matchesFilter; }

      if (!byGroup[finalGroupKey]) { byGroup[finalGroupKey] = { groupKey: finalGroupKey, totalFsns: 0, dsInstock: 0, dsTotal: 0, remarks: {} }; Object.keys(LOSS_REMARK_SEQ).forEach(k => byGroup[finalGroupKey].remarks[k] = 0); }
      if (isAllowedDS) { byGroup[finalGroupKey].dsInstock += dsInstock; byGroup[finalGroupKey].dsTotal += dsTotal; grandTotalDSInstock += dsInstock; grandTotalDSTotal += dsTotal; }
      if (isAllowedSH) { byGroup[finalGroupKey].totalFsns += fsns; grandTotalFsns += fsns; if (byGroup[finalGroupKey].remarks[remark] !== undefined) { byGroup[finalGroupKey].remarks[remark] += fsns; grandTotalRemarks[remark] += fsns; } else { byGroup[finalGroupKey].remarks['Other Loss'] += fsns; grandTotalRemarks['Other Loss'] += fsns; } }
    }

    const tableData = [];
    if (grandTotalFsns > 0 || grandTotalDSTotal > 0) {
      let gtRow = { is_gt: 0, group: 'GRAND TOTAL', total: grandTotalFsns, dsInstockPct: calcPct(grandTotalDSInstock, grandTotalDSTotal), isGrandTotal: true };
      Object.keys(LOSS_REMARK_SEQ).forEach(remark => { gtRow[remark] = calcPct(grandTotalRemarks[remark], grandTotalFsns); }); tableData.push(gtRow);
    }

    if (isShLevel) {
        const zoneTotals = {};
        Object.keys(byGroup).forEach(sh => {
            let z = shToZone[sh];
            if(!zoneTotals[z]) { zoneTotals[z] = { totalFsns:0, dsInstock:0, dsTotal:0, remarks:{} }; Object.keys(LOSS_REMARK_SEQ).forEach(k => zoneTotals[z].remarks[k] = 0); }
            zoneTotals[z].totalFsns += byGroup[sh].totalFsns; zoneTotals[z].dsInstock += byGroup[sh].dsInstock; zoneTotals[z].dsTotal += byGroup[sh].dsTotal;
            Object.keys(LOSS_REMARK_SEQ).forEach(rem => zoneTotals[z].remarks[rem] += byGroup[sh].remarks[rem]);
        });
        Object.keys(zoneTotals).sort().forEach(z => {
            let zSafe = z.replace(/[^a-zA-Z0-9]/g, '');
            let zRow = { is_gt: 1, group: z, total: zoneTotals[z].totalFsns, dsInstockPct: calcPct(zoneTotals[z].dsInstock, zoneTotals[z].dsTotal), isGrandTotal: false, isGroupHeader: true, zoneSafe: zSafe };
            Object.keys(LOSS_REMARK_SEQ).forEach(rem => zRow[rem] = calcPct(zoneTotals[z].remarks[rem], zoneTotals[z].totalFsns)); tableData.push(zRow);
            Object.keys(byGroup).sort().forEach(sh => {
                if(shToZone[sh] === z) {
                    let cRow = { is_gt: 1, group: sh, total: byGroup[sh].totalFsns, dsInstockPct: calcPct(byGroup[sh].dsInstock, byGroup[sh].dsTotal), isGrandTotal: false, isChild: true, zoneSafe: zSafe };
                    Object.keys(LOSS_REMARK_SEQ).forEach(rem => cRow[rem] = calcPct(byGroup[sh].remarks[rem], byGroup[sh].totalFsns)); tableData.push(cRow);
                }
            });
        });
    } else {
        Object.values(byGroup).forEach(group => {
          let rowData = { is_gt: 1, group: group.groupKey, total: group.totalFsns, dsInstockPct: calcPct(group.dsInstock, group.dsTotal), isGrandTotal: false };
          Object.keys(LOSS_REMARK_SEQ).forEach(remark => { rowData[remark] = calcPct(group.remarks[remark], group.totalFsns); }); tableData.push(rowData);
        });
    }

    let columns = [ { title: "", data: 'is_gt', visible: false, searchable: false }, { title: groupColName, data: 'group', render: renderGroupCol }, { title: "SH Total FSNs", data: 'total', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) }, { title: "DS Instock %", data: 'dsInstockPct', type: 'num', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding } ];
    const sortedRemarks = Object.keys(LOSS_REMARK_SEQ).sort((a,b) => LOSS_REMARK_SEQ[a] - LOSS_REMARK_SEQ[b]);
    sortedRemarks.forEach(remark => { columns.push({ title: remark === 'Instock' ? 'SH Instock %' : remark, data: remark, type: 'num', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: function (td, cellData, rowData) { if (remark === 'Instock') applyColorCoding(td, cellData, rowData); else if (!rowData.isGrandTotal && !rowData.isGroupHeader && cellData > 15) { td.style.color = '#b91c1c'; td.style.fontWeight = '700'; } } }); });

    $('#' + tableId).DataTable({
      data: tableData, columns: columns, deferRender: true, scrollX: true, scrollY: '55vh', scrollCollapse: true, fixedColumns: { left: 1 }, dom: SAFE_DOM, searchBuilder: { logic: 'AND' }, autoWidth: false, 
      orderFixed: [0, 'asc'], order: isShLevel ? [] : [[3, 'desc']], 
      paging: isShLevel ? false : true, pageLength: 50, lengthMenu: [10, 25, 50, 100, 250, 500, 1000], 
      createdRow: function (row, data) { if (data.isGrandTotal) $(row).addClass('total-row'); else if (data.isGroupHeader) { $(row).addClass('group-header'); $(row).attr('data-zone', data.zoneSafe); } else if (data.isChild) { $(row).addClass('child-row child-of-' + data.zoneSafe); } },
      drawCallback: function(settings) {
          var api = this.api(); var $body = $(api.table().body()); var parents = $body.find('tr.group-header');
          parents.each(function() {
              var zoneSafe = $(this).attr('data-zone'); var children = $body.find('tr.child-of-' + zoneSafe);
              if ($(this).hasClass('collapsed')) { children.hide(); } else { children.show(); } $(this).after(children);
          });
      }
    });
  } catch (err) { console.error("P1 render error", err); }
}

function buildTableP2(tableId, data, groupCol, groupColName) {
  try {
    let isShLevel = (groupColName === 'SH (FC Code)');
    const uniqueDates = GLOBAL_DATES;
    const latestDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null;
    
    const byGroup = {}; const shToZone = {}; let grandTotalByDate = {};
    uniqueDates.forEach(d => grandTotalByDate[d] = { shInstock: 0, shTotal: 0, dsInstock: 0, dsTotal: 0 });

    let gColIdx = findCol(colIdxP2, [groupCol]);
    let rDateIdx = findCol(colIdxP2, ['Report_Date']), remIdx = findCol(colIdxP2, ['Loss_Remark']);
    let buyIdx = findCol(colIdxP2, ['Buying_Node_Flag']), fsnIdx = findCol(colIdxP2, ['FSN_Count']), tdIdx = findCol(colIdxP2, ['Total_DS_Count']), idiIdx = findCol(colIdxP2, ['Instock_DS_Count']);
    let zIdx = findCol(colIdxP2, ['Zone']);
    let titleIdx = findCol(colIdxP2, ['Title', 'Product_Title']);

    let bnFiltersRaw = $('#filter-buying-node').val() || [];
    let mappedBnFilters = bnFiltersRaw.map(v => String(v).toLowerCase().trim());

    for (let i = 0; i < data.length; i++) {
      let row = data[i];
      let groupKey = (gColIdx !== undefined && row[gColIdx] ? row[gColIdx] : 'Unknown').toString().trim();
      let reportDate = String(row[rDateIdx] || 'Unknown');
      
      let finalGroupKey = groupKey;
      if (groupColName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel) shToZone[finalGroupKey] = zIdx !== undefined ? (row[zIdx] || 'Unassigned').toString().trim() : 'Unassigned';

      const remark = String(row[remIdx] || '').trim().toLowerCase(), buyNode = String(row[buyIdx] || '').trim().toLowerCase();
      const countFSN = Number(row[fsnIdx]) || 0;
      let countTotalDS = Number(row[tdIdx]) || 0;
      let countInstockDS = Number(row[idiIdx]) || 0;

      let isAllowedSH = false; let isAllowedDS = false;
      if (bnFiltersRaw.length === 0) { isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true'); isAllowedDS = true; } 
      else { let matchesFilter = mappedBnFilters.includes(buyNode); isAllowedSH = matchesFilter; isAllowedDS = matchesFilter; }

      if (!byGroup[finalGroupKey]) { byGroup[finalGroupKey] = { groupKey: finalGroupKey }; uniqueDates.forEach(d => byGroup[finalGroupKey][d] = { shInstock: 0, shTotal: 0, dsInstock: 0, dsTotal: 0 }); }
      
      if (isAllowedSH && uniqueDates.includes(reportDate)) {
          byGroup[finalGroupKey][reportDate].shTotal += countFSN; grandTotalByDate[reportDate].shTotal += countFSN;
          if (remark === 'instock') { byGroup[finalGroupKey][reportDate].shInstock += countFSN; grandTotalByDate[reportDate].shInstock += countFSN; }
      }
      if (isAllowedDS && uniqueDates.includes(reportDate)) {
          byGroup[finalGroupKey][reportDate].dsTotal += countTotalDS; byGroup[finalGroupKey][reportDate].dsInstock += countInstockDS;
          grandTotalByDate[reportDate].dsTotal += countTotalDS; grandTotalByDate[reportDate].dsInstock += countInstockDS;
      }
    }

    const tableData = [];
    let gtRow = { is_gt: 0, group: 'GRAND TOTAL', isGrandTotal: true };
    let gtHasData = false;
    gtRow['latestTotalFSNs'] = latestDate ? grandTotalByDate[latestDate].shTotal : 0;
    gtRow['latestDSLoss'] = latestDate ? (grandTotalByDate[latestDate].dsTotal - grandTotalByDate[latestDate].dsInstock) : 0;

    uniqueDates.forEach(d => {
      if(grandTotalByDate[d].shTotal > 0 || grandTotalByDate[d].dsTotal > 0) gtHasData = true;
      gtRow[d + '_sh'] = calcPct(grandTotalByDate[d].shInstock, grandTotalByDate[d].shTotal);
      gtRow[d + '_ds'] = calcPct(grandTotalByDate[d].dsInstock, grandTotalByDate[d].dsTotal);
    });
    if(gtHasData) tableData.push(gtRow);

    if (isShLevel) {
        const zoneTotals = {};
        Object.keys(byGroup).forEach(sh => {
            let z = shToZone[sh];
            if(!zoneTotals[z]) { zoneTotals[z] = {}; uniqueDates.forEach(d => zoneTotals[z][d] = { shInstock: 0, shTotal: 0, dsInstock: 0, dsTotal: 0 }); }
            uniqueDates.forEach(d => { zoneTotals[z][d].shTotal += byGroup[sh][d].shTotal; zoneTotals[z][d].shInstock += byGroup[sh][d].shInstock; zoneTotals[z][d].dsTotal += byGroup[sh][d].dsTotal; zoneTotals[z][d].dsInstock += byGroup[sh][d].dsInstock; });
        });
        Object.keys(zoneTotals).sort().forEach(z => {
            let zSafe = z.replace(/[^a-zA-Z0-9]/g, '');
            let zRow = { is_gt: 1, group: z, isGrandTotal: false, isGroupHeader: true, zoneSafe: zSafe, latestTotalFSNs: latestDate ? zoneTotals[z][latestDate].shTotal : 0, latestDSLoss: latestDate ? (zoneTotals[z][latestDate].dsTotal - zoneTotals[z][latestDate].dsInstock) : 0 };
            uniqueDates.forEach(d => { zRow[d+'_sh'] = calcPct(zoneTotals[z][d].shInstock, zoneTotals[z][d].shTotal); zRow[d+'_ds'] = calcPct(zoneTotals[z][d].dsInstock, zoneTotals[z][d].dsTotal); });
            tableData.push(zRow);
            Object.keys(byGroup).sort().forEach(sh => {
                if(shToZone[sh] === z) {
                    let cRow = { is_gt: 1, group: sh, isGrandTotal: false, isChild: true, zoneSafe: zSafe, latestTotalFSNs: latestDate ? byGroup[sh][latestDate].shTotal : 0, latestDSLoss: latestDate ? (byGroup[sh][latestDate].dsTotal - byGroup[sh][latestDate].dsInstock) : 0 };
                    uniqueDates.forEach(d => { cRow[d+'_sh'] = calcPct(byGroup[sh][d].shInstock, byGroup[sh][d].shTotal); cRow[d+'_ds'] = calcPct(byGroup[sh][d].dsInstock, byGroup[sh][d].dsTotal); });
                    tableData.push(cRow);
                }
            });
        });
    } else {
        Object.values(byGroup).forEach(groupObj => {
          let rowData = { is_gt: 1, group: groupObj.groupKey, isGrandTotal: false }, rowHasData = false;
          rowData['latestTotalFSNs'] = latestDate ? groupObj[latestDate].shTotal : 0;
          rowData['latestDSLoss'] = latestDate ? (groupObj[latestDate].dsTotal - groupObj[latestDate].dsInstock) : 0;

          uniqueDates.forEach(d => {
            if (groupObj[d].shTotal > 0 || groupObj[d].dsTotal > 0) rowHasData = true;
            rowData[d + '_sh'] = calcPct(groupObj[d].shInstock, groupObj[d].shTotal);
            rowData[d + '_ds'] = calcPct(groupObj[d].dsInstock, groupObj[d].dsTotal);
          });
          if(rowHasData) tableData.push(rowData);
        });
    }

    let columns = [
      { title: "", data: 'is_gt', visible: false, searchable: false },
      { title: groupColName, data: 'group', render: renderGroupCol },
      { title: "Total FSNs (Latest SH)", data: 'latestTotalFSNs', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) },
      { title: "Latest DS Loss", data: 'latestDSLoss', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) }
    ];
    
    uniqueDates.forEach(dateLabel => {
      columns.push({ title: dateLabel + ' (SH)', data: dateLabel + '_sh', type: 'num', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding });
    });

    uniqueDates.forEach((dateLabel, index) => {
      columns.push({ 
          title: dateLabel + ' (DS)', data: dateLabel + '_ds', type: 'num', className: index === 0 ? 'section-divider' : '', 
          render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding 
      });
    });

    $('#' + tableId).DataTable({
      data: tableData, columns: columns, deferRender: true, scrollX: true, scrollY: '55vh', scrollCollapse: true, fixedColumns: { left: 1 }, 
      dom: SAFE_DOM, searchBuilder: { logic: 'AND' }, autoWidth: false, 
      orderFixed: [0, 'asc'], order: [], 
      paging: isShLevel ? false : true, pageLength: 50, lengthMenu: [10, 25, 50, 100, 250, 500, 1000], 
      createdRow: function (row, data) { 
          if (data.isGrandTotal) $(row).addClass('total-row'); 
          else if (data.isGroupHeader) { $(row).addClass('group-header'); $(row).attr('data-zone', data.zoneSafe); }
          else if (data.isChild) { $(row).addClass('child-row child-of-' + data.zoneSafe); }
      },
      drawCallback: function(settings) {
          var api = this.api(); var $body = $(api.table().body()); var parents = $body.find('tr.group-header');
          parents.each(function() {
              var zoneSafe = $(this).attr('data-zone'); var children = $body.find('tr.child-of-' + zoneSafe);
              if ($(this).hasClass('collapsed')) { children.hide(); } else { children.show(); } $(this).after(children);
          });
      }
    });
  } catch (err) { console.error("P2 render error", err); }
}

function buildTableP3(tableId, data, groupCol, groupColName) {
  try {
    let isShLevel = (groupColName === 'SH (FC Code)');
    const latestDate = GLOBAL_DATES.length > 0 ? GLOBAL_DATES[GLOBAL_DATES.length - 1] : null;
    const uniqueDates = [...GLOBAL_DATES].reverse(); 
    const byGroup = {}; const shToZone = {}; let grandTotalByDate = {};
    
    uniqueDates.forEach(d => grandTotalByDate[d] = { atp: 0, sch: 0, po: 0, norm: 0, shTotal: 0 });

    let gColIdx = findCol(colIdxP2, [groupCol]);
    let rDateIdx = findCol(colIdxP2, ['Report_Date']);
    let buyIdx = findCol(colIdxP2, ['Buying_Node_Flag']);
    let fsnIdx = findCol(colIdxP2, ['FSN_Count']);
    let zIdx = findCol(colIdxP2, ['Zone']);
    let titleIdx = findCol(colIdxP2, ['Title', 'Product_Title']);
    
    let idxMstnAtp = findCol(colIdxP2, ['MSTN_atp']);
    let idxMstnSch = findCol(colIdxP2, ['MSTN_with_scheduling']);
    let idxMstnPo  = findCol(colIdxP2, ['MSTN_with_po']);
    let idxNorm    = findCol(colIdxP2, ['new_norm']);

    let bnFiltersRaw = $('#filter-buying-node').val() || [];
    let mappedBnFilters = bnFiltersRaw.map(v => String(v).toLowerCase().trim());

    for (let i = 0; i < data.length; i++) {
      let row = data[i];
      let groupKey = (gColIdx !== undefined && row[gColIdx] ? row[gColIdx] : 'Unknown').toString().trim();
      let reportDate = String(row[rDateIdx] || 'Unknown');
      
      let finalGroupKey = groupKey;
      if (groupColName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel) shToZone[finalGroupKey] = zIdx !== undefined ? (row[zIdx] || 'Unassigned').toString().trim() : 'Unassigned';
      
      const buyNode = String(row[buyIdx] || '').trim().toLowerCase();
      const countFSN = Number(row[fsnIdx]) || 0;

      let isAllowedSH = false;
      if (bnFiltersRaw.length === 0) isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true');
      else isAllowedSH = mappedBnFilters.includes(buyNode);

      if (!byGroup[finalGroupKey]) {
        byGroup[finalGroupKey] = { groupKey: finalGroupKey };
        uniqueDates.forEach(d => byGroup[finalGroupKey][d] = { atp: 0, sch: 0, po: 0, norm: 0, shTotal: 0 });
      }
      
      if (isAllowedSH && uniqueDates.includes(reportDate)) {
          let valAtp = Number(row[idxMstnAtp]) || 0, valSch = Number(row[idxMstnSch]) || 0, valPo  = Number(row[idxMstnPo]) || 0;
          let valNorm = Number(row[idxNorm]) || 0;

          byGroup[finalGroupKey][reportDate].atp += valAtp; byGroup[finalGroupKey][reportDate].sch += valSch; byGroup[finalGroupKey][reportDate].po += valPo; byGroup[finalGroupKey][reportDate].norm += valNorm; byGroup[finalGroupKey][reportDate].shTotal += countFSN;
          grandTotalByDate[reportDate].atp += valAtp; grandTotalByDate[reportDate].sch += valSch; grandTotalByDate[reportDate].po += valPo; grandTotalByDate[reportDate].norm += valNorm; grandTotalByDate[reportDate].shTotal += countFSN;
      }
    }

    const tableData = [];
    let gtRow = { is_gt: 0, group: 'GRAND TOTAL', isGrandTotal: true };
    let gtHasData = false;

    gtRow['latestTotalFSNs'] = latestDate ? grandTotalByDate[latestDate].shTotal : 0;

    uniqueDates.forEach(d => {
      if(grandTotalByDate[d].norm > 0) gtHasData = true;
      gtRow[d + '_atp'] = calcPct(grandTotalByDate[d].atp, grandTotalByDate[d].norm);
      gtRow[d + '_sch'] = calcPct(grandTotalByDate[d].sch, grandTotalByDate[d].norm);
      gtRow[d + '_po']  = calcPct(grandTotalByDate[d].po, grandTotalByDate[d].norm);
    });
    if(gtHasData) tableData.push(gtRow);

    if (isShLevel) {
        const zoneTotals = {};
        Object.keys(byGroup).forEach(sh => {
            let z = shToZone[sh];
            if(!zoneTotals[z]) { zoneTotals[z] = {}; uniqueDates.forEach(d => zoneTotals[z][d] = { atp: 0, sch: 0, po: 0, norm: 0, shTotal: 0 }); }
            uniqueDates.forEach(d => { zoneTotals[z][d].atp += byGroup[sh][d].atp; zoneTotals[z][d].sch += byGroup[sh][d].sch; zoneTotals[z][d].po += byGroup[sh][d].po; zoneTotals[z][d].norm += byGroup[sh][d].norm; zoneTotals[z][d].shTotal += byGroup[sh][d].shTotal; });
        });
        Object.keys(zoneTotals).sort().forEach(z => {
            let zSafe = z.replace(/[^a-zA-Z0-9]/g, '');
            let zRow = { is_gt: 1, group: z, isGrandTotal: false, isGroupHeader: true, zoneSafe: zSafe, latestTotalFSNs: latestDate ? zoneTotals[z][latestDate].shTotal : 0 };
            uniqueDates.forEach(d => { zRow[d+'_atp'] = calcPct(zoneTotals[z][d].atp, zoneTotals[z][d].norm); zRow[d+'_sch'] = calcPct(zoneTotals[z][d].sch, zoneTotals[z][d].norm); zRow[d+'_po'] = calcPct(zoneTotals[z][d].po, zoneTotals[z][d].norm); });
            tableData.push(zRow);
            Object.keys(byGroup).sort().forEach(sh => {
                if(shToZone[sh] === z) {
                    let cRow = { is_gt: 1, group: sh, isGrandTotal: false, isChild: true, zoneSafe: zSafe, latestTotalFSNs: latestDate ? byGroup[sh][latestDate].shTotal : 0 };
                    uniqueDates.forEach(d => { cRow[d+'_atp'] = calcPct(byGroup[sh][d].atp, byGroup[sh][d].norm); cRow[d+'_sch'] = calcPct(byGroup[sh][d].sch, byGroup[sh][d].norm); cRow[d+'_po'] = calcPct(byGroup[sh][d].po, byGroup[sh][d].norm); });
                    tableData.push(cRow);
                }
            });
        });
    } else {
        Object.values(byGroup).forEach(groupObj => {
          let rowData = { is_gt: 1, group: groupObj.groupKey, isGrandTotal: false }, rowHasData = false;
          rowData['latestTotalFSNs'] = latestDate ? groupObj[latestDate].shTotal : 0;

          uniqueDates.forEach(d => {
            if (groupObj[d].norm > 0) rowHasData = true;
            rowData[d + '_atp'] = calcPct(groupObj[d].atp, groupObj[d].norm);
            rowData[d + '_sch'] = calcPct(groupObj[d].sch, groupObj[d].norm);
            rowData[d + '_po']  = calcPct(groupObj[d].po, groupObj[d].norm);
          });
          if(rowHasData) tableData.push(rowData);
        });
    }

    let columns = [
      { title: "", data: 'is_gt', visible: false, searchable: false },
      { title: groupColName, data: 'group', render: renderGroupCol },
      { title: "Total FSNs (Latest SH)", data: 'latestTotalFSNs', type: 'num', render: $.fn.dataTable.render.number(',', '.', 0) }
    ];
    
    uniqueDates.forEach(dateLabel => {
      columns.push({ title: dateLabel + ' (ATP %)', data: dateLabel + '_atp', type: 'num', className: 'section-divider', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding });
      columns.push({ title: dateLabel + ' (+Sch %)', data: dateLabel + '_sch', type: 'num', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding });
      columns.push({ title: dateLabel + ' (+PO %)', data: dateLabel + '_po', type: 'num', render: function(d, t) { return t === 'display' ? d.toFixed(1) + '%' : d; }, createdCell: applyColorCoding });
    });

    $('#' + tableId).DataTable({
      data: tableData, columns: columns, deferRender: true, scrollX: true, scrollY: '55vh', scrollCollapse: true, fixedColumns: { left: 1 }, 
      dom: SAFE_DOM, searchBuilder: { logic: 'AND' }, autoWidth: false, 
      orderFixed: [0, 'asc'], order: [], 
      paging: isShLevel ? false : true, pageLength: 50, lengthMenu: [10, 25, 50, 100, 250, 500, 1000], 
      createdRow: function (row, data) { 
          if (data.isGrandTotal) $(row).addClass('total-row'); 
          else if (data.isGroupHeader) { $(row).addClass('group-header'); $(row).attr('data-zone', data.zoneSafe); }
          else if (data.isChild) { $(row).addClass('child-row child-of-' + data.zoneSafe); }
      },
      drawCallback: function(settings) {
          var api = this.api(); var $body = $(api.table().body()); var parents = $body.find('tr.group-header');
          parents.each(function() {
              var zoneSafe = $(this).attr('data-zone'); var children = $body.find('tr.child-of-' + zoneSafe);
              if ($(this).hasClass('collapsed')) { children.hide(); } else { children.show(); } $(this).after(children);
          });
      }
    });
  } catch (err) { console.error("P3 render error", err); }
}

function exportRawCSV() {
  let csvDataRows = []; let buyNodeColP1 = findCol(colIdxP1, ['Buying_Node_Flag']);
  let bnFiltersRaw = $('#filter-buying-node').val() || [];
  let mappedBnFilters = bnFiltersRaw.map(v => String(v).toLowerCase().trim());

  if (currentPage === 'p0' || currentPage === 'hub') { alert("Please select a specific Tab Level to export."); return; }

  if (currentPage === 'p1') {
    const byGroup = {};
    let zIdx = findCol(colIdxP1, ['Zone']);
    let isShLevel = (activeTabCol === 'FC_Code');
    let titleIdx = findCol(colIdxP1, ['Title', 'Product_Title']);

    activeFilteredP1.forEach(row => {
      let groupKey = (row[colIdxP1[activeTabCol]] || 'Unknown').toString().trim();
      
      let finalGroupKey = groupKey;
      if (activeTabName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel && zIdx !== undefined) { let zName = (row[zIdx] || 'Unassigned').toString().trim(); finalGroupKey = zName + " | " + finalGroupKey; }
      
      const rawRemark = String(row[findCol(colIdxP1, ['Loss_Remark'])] || '').trim().toLowerCase();
      let remark = 'Other Loss';
      
      if (rawRemark.includes('asp')) {
          remark = 'ASP Drop';
      } else if (rawRemark.includes('network')) {
          remark = 'Network Issue';
      } else {
          for (let k of Object.keys(LOSS_REMARK_SEQ)) { 
              if (k.toLowerCase() === rawRemark) { remark = k; break; } 
          }
      }

      const fsns = Number(row[findCol(colIdxP1, ['FSN_Count'])]) || 0, dsInstock = Number(row[findCol(colIdxP1, ['Instock_DS_Count'])]) || 0, dsTotal = Number(row[findCol(colIdxP1, ['Total_DS_Count'])]) || 0;
      const buyNode = buyNodeColP1 !== undefined ? (row[buyNodeColP1] || '').toString().trim().toLowerCase() : 'yes';
      
      let isAllowedSH = false; let isAllowedDS = false;
      if (bnFiltersRaw.length === 0) { isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true'); isAllowedDS = true; }
      else { let matches = mappedBnFilters.includes(buyNode); isAllowedSH = matches; isAllowedDS = matches; }

      if (!byGroup[finalGroupKey]) { byGroup[finalGroupKey] = { total: 0, dsInstock: 0, dsTotal: 0 }; Object.keys(LOSS_REMARK_SEQ).forEach(k => byGroup[finalGroupKey][k] = 0); }
      if (isAllowedDS) { byGroup[finalGroupKey].dsInstock += dsInstock; byGroup[finalGroupKey].dsTotal += dsTotal; }
      if (isAllowedSH) { byGroup[finalGroupKey].total += fsns; if (byGroup[finalGroupKey][remark] !== undefined) byGroup[finalGroupKey][remark] += fsns; }
    });

    const sortedRemarks = Object.keys(LOSS_REMARK_SEQ).sort((a,b) => LOSS_REMARK_SEQ[a] - LOSS_REMARK_SEQ[b]);
    let hName = isShLevel ? "Zone | SH (FC Code)" : activeTabName;
    let headerArr = [hName, "SH Total FSNs", "DS Instock %", "DS Instock Count", "DS Total Count"].concat(sortedRemarks);
    csvDataRows.push(headerArr.map(h => `"${h}"`).join(","));

    Object.keys(byGroup).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(group => {
      let dsPct = calcPct(byGroup[group].dsInstock, byGroup[group].dsTotal).toFixed(1) + "%";
      let rowArr = [`"${group.replace(/"/g, '""')}"`, byGroup[group].total, dsPct, byGroup[group].dsInstock, byGroup[group].dsTotal];
      sortedRemarks.forEach(rem => rowArr.push(calcPct(byGroup[group][rem], byGroup[group].total).toFixed(1) + "%")); csvDataRows.push(rowArr.join(","));
    });
  } else if (currentPage === 'p2') {
    const uniqueDates = GLOBAL_DATES;
    const byGroup = {}; const latestDate = uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null;
    let buyIdx = findCol(colIdxP2, ['Buying_Node_Flag']); let zIdx = findCol(colIdxP2, ['Zone']); let isShLevel = (activeTabCol === 'FC_Code');
    let titleIdx = findCol(colIdxP2, ['Title', 'Product_Title']);

    activeFilteredP2.forEach(row => {
      let groupKey = (row[colIdxP2[activeTabCol]] || 'Unknown').toString().trim(), reportDate = String(row[findCol(colIdxP2, ['Report_Date'])] || 'Unknown');
      
      let finalGroupKey = groupKey;
      if (activeTabName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel && zIdx !== undefined) { let zName = (row[zIdx] || 'Unassigned').toString().trim(); finalGroupKey = zName + " | " + finalGroupKey; }

      const remark = String(row[findCol(colIdxP2, ['Loss_Remark'])] || '').trim().toLowerCase(), buyNode = String(row[buyIdx] || '').trim().toLowerCase();
      const countFSN = Number(row[findCol(colIdxP2, ['FSN_Count'])]) || 0, countTotalDS = Number(row[findCol(colIdxP2, ['Total_DS_Count'])]) || 0, countInstockDS = Number(row[findCol(colIdxP2, ['Instock_DS_Count'])]) || 0;
      
      let isAllowedSH = false; let isAllowedDS = false;
      if (bnFiltersRaw.length === 0) { isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true'); isAllowedDS = true; }
      else { let matches = mappedBnFilters.includes(buyNode); isAllowedSH = matches; isAllowedDS = matches; }

      if (!byGroup[finalGroupKey]) { byGroup[finalGroupKey] = {}; uniqueDates.forEach(d => byGroup[finalGroupKey][d] = { shInstock: 0, shTotal: 0, dsInstock: 0, dsTotal: 0 }); }
      if (isAllowedSH && uniqueDates.includes(reportDate)) { byGroup[finalGroupKey][reportDate].shTotal += countFSN; if (remark === 'instock') byGroup[finalGroupKey][reportDate].shInstock += countFSN; }
      if (isAllowedDS && uniqueDates.includes(reportDate)) { byGroup[finalGroupKey][reportDate].dsTotal += countTotalDS; byGroup[finalGroupKey][reportDate].dsInstock += countInstockDS; }
    });

    let hName = isShLevel ? "Zone | SH (FC Code)" : activeTabName;
    let headerArr = [hName, "Latest DS Loss Count"];
    uniqueDates.forEach(d => { headerArr.push(`SH Instock FSNs - ${d}`, `SH Total FSNs - ${d}`, `DS Instock - ${d}`, `DS Total - ${d}`); });
    csvDataRows.push(headerArr.map(h => `"${h}"`).join(","));

    Object.keys(byGroup).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(group => {
      let latestDsLoss = latestDate ? (byGroup[group][latestDate].dsTotal - byGroup[group][latestDate].dsInstock) : 0;
      let rowArr = [`"${group.replace(/"/g, '""')}"`, latestDsLoss];
      uniqueDates.forEach(d => { rowArr.push(byGroup[group][d].shInstock, byGroup[group][d].shTotal, byGroup[group][d].dsInstock, byGroup[group][d].dsTotal); });
      csvDataRows.push(rowArr.join(","));
    });
  } else {
    const latestDate = GLOBAL_DATES.length > 0 ? GLOBAL_DATES[GLOBAL_DATES.length - 1] : null; const uniqueDates = [...GLOBAL_DATES].reverse();
    const byGroup = {}; let buyIdx = findCol(colIdxP2, ['Buying_Node_Flag']); let zIdx = findCol(colIdxP2, ['Zone']); let isShLevel = (activeTabCol === 'FC_Code');
    let idxMstnAtp = findCol(colIdxP2, ['MSTN_atp']); let idxMstnSch = findCol(colIdxP2, ['MSTN_with_scheduling']); let idxMstnPo  = findCol(colIdxP2, ['MSTN_with_po']); let idxNorm = findCol(colIdxP2, ['new_norm']); let fsnIdx = findCol(colIdxP2, ['FSN_Count']);
    let titleIdx = findCol(colIdxP2, ['Title', 'Product_Title']);

    activeFilteredP2.forEach(row => {
      let groupKey = (row[colIdxP2[activeTabCol]] || 'Unknown').toString().trim(), reportDate = String(row[findCol(colIdxP2, ['Report_Date'])] || 'Unknown');
      
      let finalGroupKey = groupKey;
      if (activeTabName === 'FSN' && titleIdx !== undefined) {
          finalGroupKey = finalGroupKey + ' - ' + (row[titleIdx] || 'Unknown');
      }

      if (isShLevel && zIdx !== undefined) { let zName = (row[zIdx] || 'Unassigned').toString().trim(); finalGroupKey = zName + " | " + finalGroupKey; }
      const buyNode = String(row[buyIdx] || '').trim().toLowerCase();
      let isAllowedSH = false;
      if (bnFiltersRaw.length === 0) isAllowedSH = (buyNode === 'yes' || buyNode === 'y' || buyNode === 'true');
      else isAllowedSH = mappedBnFilters.includes(buyNode);

      if (!byGroup[finalGroupKey]) { byGroup[finalGroupKey] = {}; uniqueDates.forEach(d => byGroup[finalGroupKey][d] = { atp: 0, sch: 0, po: 0, norm: 0, shTotal: 0 }); }
      if (isAllowedSH && uniqueDates.includes(reportDate)) { byGroup[finalGroupKey][reportDate].atp += (Number(row[idxMstnAtp]) || 0); byGroup[finalGroupKey][reportDate].sch += (Number(row[idxMstnSch]) || 0); byGroup[finalGroupKey][reportDate].po  += (Number(row[idxMstnPo]) || 0); byGroup[finalGroupKey][reportDate].norm += (Number(row[idxNorm]) || 0); byGroup[finalGroupKey][reportDate].shTotal += (Number(row[fsnIdx]) || 0); }
    });

    let hName = isShLevel ? "Zone | SH (FC Code)" : activeTabName;
    let headerArr = [hName, "Total FSNs (Latest SH)"];
    uniqueDates.forEach(d => { headerArr.push(`${d} (ATP %)`, `${d} (+Sch %)`, `${d} (+PO %)`); });
    csvDataRows.push(headerArr.map(h => `"${h}"`).join(","));

    Object.keys(byGroup).sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase())).forEach(group => {
      let latestFSN = latestDate ? byGroup[group][latestDate].shTotal : 0; let rowArr = [`"${group.replace(/"/g, '""')}"`, latestFSN];
      uniqueDates.forEach(d => { let dNorm = byGroup[group][d].norm; rowArr.push(calcPct(byGroup[group][d].atp, dNorm).toFixed(1) + "%"); rowArr.push(calcPct(byGroup[group][d].sch, dNorm).toFixed(1) + "%"); rowArr.push(calcPct(byGroup[group][d].po, dNorm).toFixed(1) + "%"); });
      csvDataRows.push(rowArr.join(","));
    });
  }

  const blob = new Blob(["\uFEFF" + csvDataRows.join("\n")], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob));
  link.setAttribute("download", `Raw_Counts_${activeTabCol}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function populateFilterOptions() {
  let sets = { bu: new Set(), company: new Set(), kam: new Set(), kamLead: new Set(), owner: new Set(), sh: new Set(), brand: new Set(), vendor: new Set(), vertical: new Set(), supercategory: new Set(), tagging: new Set(), vmi: new Set(), buyingNode: new Set(), brandPoc: new Set(), fsn: new Set(), dsBucket: new Set(), zone: new Set(), updatedBu: new Set(), gourmet: new Set(), regional: new Set(), organic: new Set(), em: new Set(), ubpl: new Set() };
  
  let idxBrandPoc1 = findCol(colIdxP1, ['brand_poc', 'brandpoc']);
  let idxDsBucket1 = findCol(colIdxP1, ['Instock_DS_Bucket', 'instockdsbucket']);
  let idxZone1 = findCol(colIdxP1, ['Zone']);
  let idxUpdatedBu1 = findCol(colIdxP1, ['Updated_BU']);
  let idxGourmet1 = findCol(colIdxP1, ['Gourmet_Flag', 'gourmet']);
  let idxRegional1 = findCol(colIdxP1, ['Regional_fsn_flag', 'regionalfsn']);
  let idxSuper1 = findCol(colIdxP1, ['Super_Category', 'supercategory']);
  let idxOrg1 = findCol(colIdxP1, ['Organic_Flag', 'organic']);
  let idxEm1 = findCol(colIdxP1, ['Engagement_Manager', 'engagementmanager']);
  let idxUbpl1 = findCol(colIdxP1, ['UB_PL_Flag', 'ubpl', 'ub_pl']);

  rawDataP1.forEach(row => {
    if(row[findCol(colIdxP1, ['BU'])]) sets.bu.add(String(row[findCol(colIdxP1, ['BU'])]).trim()); 
    if(row[findCol(colIdxP1, ['Company'])]) sets.company.add(String(row[findCol(colIdxP1, ['Company'])]).trim());
    if(row[findCol(colIdxP1, ['KAM'])]) sets.kam.add(String(row[findCol(colIdxP1, ['KAM'])]).trim()); 
    if(row[findCol(colIdxP1, ['KAM_Lead'])]) sets.kamLead.add(String(row[findCol(colIdxP1, ['KAM_Lead'])]).trim());
    if(row[findCol(colIdxP1, ['Instock_Owner'])]) sets.owner.add(String(row[findCol(colIdxP1, ['Instock_Owner'])]).trim()); 
    if(row[findCol(colIdxP1, ['FC_Code'])]) sets.sh.add(String(row[findCol(colIdxP1, ['FC_Code'])]).trim());
    if(row[findCol(colIdxP1, ['brand'])]) sets.brand.add(String(row[findCol(colIdxP1, ['brand'])]).trim()); 
    if(row[findCol(colIdxP1, ['Vendor_Name'])]) sets.vendor.add(String(row[findCol(colIdxP1, ['Vendor_Name'])]).trim());
    if(row[findCol(colIdxP1, ['analytic_vertical'])]) sets.vertical.add(String(row[findCol(colIdxP1, ['analytic_vertical'])]).trim()); 
    if(row[findCol(colIdxP1, ['tagging'])]) sets.tagging.add(String(row[findCol(colIdxP1, ['tagging'])]).trim());
    
    let vmiCol = findCol(colIdxP1, ['VMI_Flag', 'vmi']); 
    if(vmiCol !== undefined && row[vmiCol]) sets.vmi.add(String(row[vmiCol]).trim());
    
    let bnCol = findCol(colIdxP1, ['Buying_Node_Flag']); 
    if(bnCol !== undefined && row[bnCol]) sets.buyingNode.add(String(row[bnCol]).trim());
    
    if(idxBrandPoc1 !== undefined && row[idxBrandPoc1]) sets.brandPoc.add(String(row[idxBrandPoc1]).trim());
    if(idxDsBucket1 !== undefined && row[idxDsBucket1]) sets.dsBucket.add(String(row[idxDsBucket1]).trim());
    if(idxZone1 !== undefined && row[idxZone1]) sets.zone.add(String(row[idxZone1]).trim());
    if(idxUpdatedBu1 !== undefined && row[idxUpdatedBu1]) sets.updatedBu.add(String(row[idxUpdatedBu1]).trim());
    if(idxGourmet1 !== undefined && row[idxGourmet1]) sets.gourmet.add(String(row[idxGourmet1]).trim());
    if(idxRegional1 !== undefined && row[idxRegional1]) sets.regional.add(String(row[idxRegional1]).trim());
    if(idxSuper1 !== undefined && row[idxSuper1]) sets.supercategory.add(String(row[idxSuper1]).trim());
    
    if(idxOrg1 !== undefined && row[idxOrg1]) sets.organic.add(String(row[idxOrg1]).trim());
    if(idxEm1 !== undefined && row[idxEm1]) sets.em.add(String(row[idxEm1]).trim());
    if(idxUbpl1 !== undefined && row[idxUbpl1]) sets.ubpl.add(String(row[idxUbpl1]).trim());
    
    let fsnCol = findCol(colIdxP1, ['FSN', 'fsn']); 
    if(fsnCol !== undefined && row[fsnCol]) sets.fsn.add(String(row[fsnCol]).trim());
  });
  const fillSelect = (id, set) => { const el = $(id); Array.from(set).sort().forEach(val => el.append(new Option(val, val))); };
  fillSelect('#filter-bu', sets.bu); fillSelect('#filter-company', sets.company); fillSelect('#filter-kam', sets.kam); fillSelect('#filter-kam-lead', sets.kamLead); fillSelect('#filter-owner', sets.owner);
  fillSelect('#filter-sh', sets.sh); fillSelect('#filter-brand', sets.brand); fillSelect('#filter-vendor', sets.vendor); fillSelect('#filter-vertical', sets.vertical); fillSelect('#filter-tagging', sets.tagging); fillSelect('#filter-vmi', sets.vmi); fillSelect('#filter-supercategory', sets.supercategory);
  fillSelect('#filter-buying-node', sets.buyingNode); fillSelect('#filter-brand-poc', sets.brandPoc); fillSelect('#filter-fsn', sets.fsn); fillSelect('#filter-ds-bucket', sets.dsBucket); fillSelect('#filter-zone', sets.zone); fillSelect('#filter-updated-bu', sets.updatedBu); fillSelect('#filter-gourmet', sets.gourmet); fillSelect('#filter-regional', sets.regional);
  fillSelect('#filter-organic', sets.organic); fillSelect('#filter-em', sets.em); fillSelect('#filter-ubpl', sets.ubpl);
}
