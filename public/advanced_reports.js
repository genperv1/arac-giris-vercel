// advanced_reports.js
// Gelişmiş raporlama sistemi

const ADV_REPORT_TZ = 'Europe/Istanbul';
function advFormatIstanbulTime(ms) {
    try {
        const d = new Date(Number(ms));
        if (isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: ADV_REPORT_TZ,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            hourCycle: 'h23'
        }).format(d);
    } catch (e) {
        return '';
    }
}

class AdvancedReports {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 25;
        this.totalItems = 0;
        this.data = [];
        this.filteredData = [];
        this.filters = {
            startDate: null,
            endDate: null,
            firma: '',
            basimYeri: '',
            plate: ''
        };
        this.charts = {};
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadInitialData();
        this.setDefaultDates();
        await this.applyFilters();
    }

    setupEventListeners() {
        document.getElementById('plateSearch')?.addEventListener('input', (e) => {
            this.filters.plate = e.target.value;
            this.filterAndRender();
        });

        document.getElementById('pageSize')?.addEventListener('change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.currentPage = 1;
            this.renderTable();
        });

        document.getElementById('startDate')?.addEventListener('change', (e) => {
            this.filters.startDate = e.target.value;
        });

        document.getElementById('endDate')?.addEventListener('change', (e) => {
            this.filters.endDate = e.target.value;
        });

        document.getElementById('firmaFilter')?.addEventListener('change', (e) => {
            this.filters.firma = e.target.value;
        });

        document.getElementById('basimYeriFilter')?.addEventListener('change', (e) => {
            this.filters.basimYeri = e.target.value;
        });
    }

    setDefaultDates() {
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
        
        document.getElementById('startDate').value = lastMonth.toISOString().split('T')[0];
        document.getElementById('endDate').value = today.toISOString().split('T')[0];
        
        this.filters.startDate = lastMonth.toISOString().split('T')[0];
        this.filters.endDate = today.toISOString().split('T')[0];
    }

    async loadInitialData() {
        try {
            this.showLoading();
            const response = await fetch('/api/reports?_cb=' + Date.now(), {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-store, no-cache, must-revalidate',
                    'Pragma': 'no-cache'
                },
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Veriler yüklenemedi');
            
            const reports = await response.json();
            this.data = this.processReportsData(reports);
            this.populateFilters();
            this.hideLoading();
        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            this.hideLoading();
            this.showError('Veriler yüklenirken hata oluştu');
        }
    }

    processReportsData(reports) {
        return reports
            .filter(report => report.type === 'PRINT' && report.data)
            .map(report => ({
                id: report.id,
                plaka: report.data.plaka || report.data.plate || '',
                firma: report.data.firma || report.data.firmaKodu || '',
                tarih: report.data.tarih || new Date(report.ts).toISOString().split('T')[0],
                saat: (Number.isFinite(Number(report.ts)) && Number(report.ts) > 0)
                    ? advFormatIstanbulTime(report.ts)
                    : (report.data.saat || ''),
                basimYeri: report.data.basimYeri || '',
                malzeme: report.data.malzeme || '',
                sevkYeri: report.data.sevkYeri || '',
                tonaj: report.data.tonaj || '',
                timestamp: report.ts,
                rawData: report.data
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
    }

    populateFilters() {
        // Firmaları doldur
        const firmas = [...new Set(this.data.map(item => item.firma).filter(Boolean))];
        const firmaSelect = document.getElementById('firmaFilter');
        if (firmaSelect) {
            firmaSelect.innerHTML = '<option value="">Tüm Firmalar</option>';
            firmas.forEach(firma => {
                firmaSelect.innerHTML += `<option value="${firma}">${firma}</option>`;
            });
        }

        // Baskı yerlerini doldur
        const basimYerleri = [...new Set(this.data.map(item => item.basimYeri).filter(Boolean))];
        const basimSelect = document.getElementById('basimYeriFilter');
        if (basimSelect) {
            basimSelect.innerHTML = '<option value="">Tüm Baskı Yerleri</option>';
            basimYerleri.forEach(yer => {
                basimSelect.innerHTML += `<option value="${yer}">${yer}</option>`;
            });
        }
    }

    async applyFilters() {
        this.showLoading();
        this.filterData();
        this.updateStatistics();
        this.renderCharts();
        this.renderTable();
        this.hideLoading();
    }

    filterData() {
        this.filteredData = this.data.filter(item => {
            // Tarih filtresi
            if (this.filters.startDate && item.tarih < this.filters.startDate) return false;
            if (this.filters.endDate && item.tarih > this.filters.endDate) return false;
            
            // Firma filtresi
            if (this.filters.firma && item.firma !== this.filters.firma) return false;
            
            // Baskı yeri filtresi
            if (this.filters.basimYeri && item.basimYeri !== this.filters.basimYeri) return false;
            
            // Plaka araması
            if (this.filters.plate && !item.plaka.toLowerCase().includes(this.filters.plate.toLowerCase())) {
                return false;
            }
            
            return true;
        });
        
        this.totalItems = this.filteredData.length;
        this.currentPage = 1;
    }

    filterAndRender() {
        this.filterData();
        this.renderTable();
    }

    updateStatistics() {
        const totalVehicles = new Set(this.filteredData.map(item => item.plaka)).size;
        const totalPrints = this.filteredData.length;
        const totalFirmas = new Set(this.filteredData.map(item => item.firma).filter(Boolean)).size;
        
        // Gün sayısını hesapla
        const dateRange = this.getDateRange();
        const avgPerDay = dateRange > 0 ? Math.round(totalPrints / dateRange) : 0;

        document.getElementById('totalVehicles').textContent = totalVehicles;
        document.getElementById('totalPrints').textContent = totalPrints;
        document.getElementById('totalFirmas').textContent = totalFirmas;
        document.getElementById('avgPerDay').textContent = avgPerDay;
    }

    getDateRange() {
        if (!this.filteredData.length) return 0;
        
        const dates = this.filteredData.map(item => new Date(item.tarih));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        
        return Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    }

    renderCharts() {
        this.renderDailyChart();
        this.renderFirmaChart();
    }

    renderDailyChart() {
        const ctx = document.getElementById('dailyChart')?.getContext('2d');
        if (!ctx) return;

        // Günlük verileri grupla
        const dailyData = {};
        this.filteredData.forEach(item => {
            const date = item.tarih;
            dailyData[date] = (dailyData[date] || 0) + 1;
        });

        const sortedDates = Object.keys(dailyData).sort();
        const labels = sortedDates.slice(-30); // Son 30 gün
        const data = labels.map(date => dailyData[date] || 0);

        // Eğer chart zaten varsa yok et
        if (this.charts.daily) {
            this.charts.daily.destroy();
        }

        this.charts.daily = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Günlük Baskı Sayısı',
                    data: data,
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    renderFirmaChart() {
        const ctx = document.getElementById('firmaChart')?.getContext('2d');
        if (!ctx) return;

        // Firma verilerini grupla
        const firmaData = {};
        this.filteredData.forEach(item => {
            if (item.firma) {
                firmaData[item.firma] = (firmaData[item.firma] || 0) + 1;
            }
        });

        const sortedFirmas = Object.entries(firmaData)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // Top 10 firma

        const labels = sortedFirmas.map(([firma]) => firma);
        const data = sortedFirmas.map(([, count]) => count);

        // Eğer chart zaten varsa yok et
        if (this.charts.firma) {
            this.charts.firma.destroy();
        }

        this.charts.firma = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
                        '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    renderTable() {
        const tbody = document.getElementById('reportTableBody');
        if (!tbody) return;

        const startIndex = (this.currentPage - 1) * this.pageSize;
        const endIndex = startIndex + this.pageSize;
        const pageData = this.filteredData.slice(startIndex, endIndex);

        tbody.innerHTML = pageData.map(item => `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${item.plaka}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${item.firma || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div>${item.tarih}</div>
                    <div class="text-xs text-gray-400">${item.saat}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${item.basimYeri || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${item.malzeme || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button onclick="advancedReports.copyToClipboard('${item.plaka}', '${item.firma}', '${item.tarih}')" 
                            class="text-blue-600 hover:text-blue-900 mr-2" title="Kopyala">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button onclick="advancedReports.viewDetails('${item.id}')" 
                            class="text-green-600 hover:text-green-900" title="Detay">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `).join('');

        this.renderPagination();
    }

    renderPagination() {
        const pagination = document.getElementById('pagination');
        if (!pagination) return;

        const totalPages = Math.ceil(this.totalItems / this.pageSize);
        const startItem = (this.currentPage - 1) * this.pageSize + 1;
        const endItem = Math.min(this.currentPage * this.pageSize, this.totalItems);

        let paginationHTML = `
            <div class="text-sm text-gray-700">
                ${startItem}-${endItem} / ${this.totalItems} kayıt
            </div>
            <div class="flex space-x-2">
        `;

        // Previous button
        paginationHTML += `
            <button onclick="advancedReports.goToPage(${this.currentPage - 1})" 
                    ${this.currentPage === 1 ? 'disabled' : ''} 
                    class="px-3 py-1 border rounded ${this.currentPage === 1 ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-gray-50'}">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;

        // Page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button onclick="advancedReports.goToPage(${i})" 
                        class="px-3 py-1 border rounded ${i === this.currentPage ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'}">
                    ${i}
                </button>
            `;
        }

        // Next button
        paginationHTML += `
            <button onclick="advancedReports.goToPage(${this.currentPage + 1})" 
                    ${this.currentPage === totalPages ? 'disabled' : ''} 
                    class="px-3 py-1 border rounded ${this.currentPage === totalPages ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-gray-50'}">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        paginationHTML += '</div>';
        pagination.innerHTML = paginationHTML;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.totalItems / this.pageSize);
        if (page < 1 || page > totalPages) return;
        
        this.currentPage = page;
        this.renderTable();
    }

    copyToClipboard(plaka, firma, tarih) {
        const text = `Plaka: ${plaka}\nFirma: ${firma}\nTarih: ${tarih}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                this.showSuccess('Kopyalandı!');
            });
        } else {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showSuccess('Kopyalandı!');
        }
    }

    viewDetails(id) {
        const item = this.data.find(d => d.id === id);
        if (!item) return;

        const details = `
            Plaka: ${item.plaka}
            Firma: ${item.firma || '-'}
            Tarih: ${item.tarih}
            Saat: ${item.saat}
            Baskı Yeri: ${item.basimYeri || '-'}
            Malzeme: ${item.malzeme || '-'}
            Sevk Yeri: ${item.sevkYeri || '-'}
            Tonaj: ${item.tonaj || '-'}
        `;

        alert(details);
    }

    async exportToExcel() {
        try {
            this.showLoading();
            
            // CSV formatında veri hazırla
            const headers = ['Plaka', 'Firma', 'Tarih', 'Saat', 'Baskı Yeri', 'Malzeme', 'Sevk Yeri', 'Tonaj'];
            const csvContent = [
                headers.join(','),
                ...this.filteredData.map(item => [
                    `"${item.plaka}"`,
                    `"${item.firma}"`,
                    `"${item.tarih}"`,
                    `"${item.saat}"`,
                    `"${item.basimYeri}"`,
                    `"${item.malzeme}"`,
                    `"${item.sevkYeri}"`,
                    `"${item.tonaj}"`
                ].join(','))
            ].join('\n');

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `rapor_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.hideLoading();
            this.showSuccess('Excel dosyası indirildi!');
        } catch (error) {
            console.error('Export hatası:', error);
            this.hideLoading();
            this.showError('Excel dosyası oluşturulurken hata oluştu');
        }
    }

    showLoading() {
        document.getElementById('loadingOverlay').classList.remove('hidden');
    }

    hideLoading() {
        document.getElementById('loadingOverlay').classList.add('hidden');
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg text-white z-50 fade-in ${
            type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Global functions
window.resetFilters = function() {
    const advancedReports = window.advancedReports;
    if (advancedReports) {
        document.getElementById('plateSearch').value = '';
        document.getElementById('firmaFilter').value = '';
        document.getElementById('basimYeriFilter').value = '';
        advancedReports.setDefaultDates();
        advancedReports.applyFilters();
    }
};

window.applyFilters = function() {
    const advancedReports = window.advancedReports;
    if (advancedReports) {
        advancedReports.applyFilters();
    }
};

window.exportToExcel = function() {
    const advancedReports = window.advancedReports;
    if (advancedReports) {
        advancedReports.exportToExcel();
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.advancedReports = new AdvancedReports();
});
