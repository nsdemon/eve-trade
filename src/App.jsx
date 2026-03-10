import { useState, useEffect, useMemo } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import './App.css'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

// API is on same server (relative URL)
const API = '/api'

async function apiJson(res) {
  const text = await res.text()
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json') || text.trimStart().startsWith('<')) {
    throw new Error('Server returned an error. Run: npm run start — then open http://localhost:3001')
  }
  return JSON.parse(text)
}

export default function App() {
  const [regions, setRegions] = useState({})
  const [selectedRegions, setSelectedRegions] = useState([])
  const [month, setMonth] = useState('')
  const [topData, setTopData] = useState({})
  const [typeNames, setTypeNames] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('volume')
  const [sortDir, setSortDir] = useState('desc')
  const [dataTab, setDataTab] = useState('items') // items | modules | ships | daytrade
  const [daytradeData, setDaytradeData] = useState([])
  const [daytradeMonth, setDaytradeMonth] = useState(null) // server-confirmed month (last month only)
  const [daytradeView, setDaytradeView] = useState('isk') // 'isk' | 'percent' — sort by profit ISK or profit %
  const [viewMode, setViewMode] = useState('table') // table | graph
  const [graphRegion, setGraphRegion] = useState('')
  const [graphTypeId, setGraphTypeId] = useState('')
  const [graphHistory, setGraphHistory] = useState([])

  useEffect(() => {
    fetch(`${API}/regions`)
      .then(r => apiJson(r))
      .then(setRegions)
      .catch(e => setError(e?.message || String(e)))
  }, [])

  useEffect(() => {
    if (!month) {
      const d = new Date()
      // Default to last complete month (data only from last month)
      d.setMonth(d.getMonth() - 1)
      const y = d.getFullYear()
      const m = d.getMonth() + 1
      setMonth(`${y}-${String(m).padStart(2, '0')}`)
    }
  }, [month])

  useEffect(() => {
    if (Object.keys(regions).length === 0) return
    // Default to Jita only at startup (first region = The Forge / Jita)
    setSelectedRegions(Object.keys(regions).slice(0, 1))
  }, [regions])

  const lastMonthOnly = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}`
  }, [])

  const fetchTopData = async (category) => {
    setLoading(true)
    setError(null)
    setTopData({})
    try {
      const regionIds = selectedRegions.length ? selectedRegions : Object.keys(regions)
      const path = category === 'modules' ? 'top/modules' : category === 'ships' ? 'top/ships' : 'top/items'
      const limit = (category === 'modules' || category === 'ships') ? '25' : '10'
      const results = {}
      for (const rid of regionIds) {
        const params = new URLSearchParams({ month, limit })
        const res = await fetch(`${API}/markets/${rid}/${path}?${params}`)
        results[rid] = await apiJson(res)
      }
      setTopData(results)
      const allTypeIds = [...new Set(Object.values(results).flat().map(r => r.type_id))]
      if (allTypeIds.length > 0) {
        const namesRes = await fetch(`${API}/types/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: allTypeIds }),
        })
        setTypeNames(await apiJson(namesRes))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchDaytradeData = async () => {
    setLoading(true)
    setError(null)
    setDaytradeData([])
    setDaytradeMonth(null)
    try {
      const res = await fetch(`${API}/markets/jita/daytrade?limit=20`)
      const data = await apiJson(res)
      // Server always returns last month only; response is { month, items }
      const items = data.items ?? data
      setDaytradeData(Array.isArray(items) ? items : [])
      setDaytradeMonth(data.month ?? null)
      const typeIds = (Array.isArray(items) ? items : []).map(r => r.type_id)
      if (typeIds.length > 0) {
        const namesRes = await fetch(`${API}/types/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: typeIds }),
        })
        const names = await apiJson(namesRes)
        setTypeNames(prev => ({ ...prev, ...names }))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Day trade: use only last month
  useEffect(() => {
    if (dataTab === 'daytrade' && month && month !== lastMonthOnly) {
      setMonth(lastMonthOnly)
    }
  }, [dataTab, month, lastMonthOnly])

  useEffect(() => {
    if (!month) return
    if (dataTab === 'daytrade') {
      fetchDaytradeData()
    } else if (selectedRegions.length) {
      fetchTopData(dataTab)
    }
  }, [selectedRegions.join(','), month, dataTab])

  const fetchGraphHistory = async () => {
    if (!graphRegion || !graphTypeId) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/markets/${graphRegion}/history/${graphTypeId}`)
      const data = await apiJson(res)
      setGraphHistory(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const flatData = useMemo(() => {
    const rows = []
    for (const [regionId, items] of Object.entries(topData)) {
      for (const item of items) {
        rows.push({
          ...item,
          region_id: regionId,
          region_name: regions[regionId] || regionId,
          type_name: typeNames[item.type_id] ?? typeNames[String(item.type_id)] ?? `Type ${item.type_id}`,
        })
      }
    }
    return rows
  }, [topData, typeNames, regions])

  const daytradeRows = useMemo(() => {
    const rows = daytradeData.map(row => ({
      ...row,
      type_name: typeNames[row.type_id] ?? typeNames[String(row.type_id)] ?? `Type ${row.type_id}`,
    }))
    // Percent tab: sort most to least by profit %
    if (daytradeView === 'percent') {
      return [...rows].sort((a, b) => (b.profit_pct ?? 0) - (a.profit_pct ?? 0))
    }
    return rows
  }, [daytradeData, typeNames, daytradeView])

  const filteredData = useMemo(() => {
    let data = [...flatData]
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      data = data.filter(r => 
        (r.type_name || '').toLowerCase().includes(q) ||
        (r.region_name || '').toLowerCase().includes(q) ||
        String(r.type_id).includes(q)
      )
    }
    const mult = sortDir === 'desc' ? 1 : -1
    data.sort((a, b) => {
      const av = a[sortBy] ?? 0
      const bv = b[sortBy] ?? 0
      return mult * (typeof av === 'string' ? av.localeCompare(bv) : (av - bv))
    })
    return data
  }, [flatData, searchQuery, sortBy, sortDir])

  const barChartData = useMemo(() => {
    const top = filteredData.slice(0, 15)
    if (!top.length) return null
    const byItem = {}
    for (const row of top) {
      const key = row.type_name
      if (!byItem[key]) byItem[key] = { volumes: {}, total: 0 }
      byItem[key].volumes[row.region_name] = row.volume
      byItem[key].total += row.volume
    }
    const sorted = Object.entries(byItem).sort((a, b) => b[1].total - a[1].total).slice(0, 10)
    const labels = sorted.map(([name]) => name)
    const regions = [...new Set(filteredData.map(r => r.region_name))]
    return {
      labels,
      datasets: regions.map((region, i) => ({
        label: region,
        data: labels.map(name => byItem[name]?.volumes[region] || 0),
        backgroundColor: `hsla(${200 + i * 70}, 70%, 50%, 0.7)`,
        borderColor: `hsl(${200 + i * 70}, 70%, 50%)`,
        borderWidth: 1,
      })),
    }
  }, [filteredData])

  const lineChartData = useMemo(() => {
    if (!graphHistory.length) return null
    const sorted = [...graphHistory].sort((a, b) => a.date.localeCompare(b.date))
    return {
      labels: sorted.map(d => d.date),
      datasets: [
        { label: 'Volume', data: sorted.map(d => d.volume), borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true },
        { label: 'Avg Price', data: sorted.map(d => d.average), borderColor: '#ffb347', yAxisID: 'y1' },
      ],
    }
  }, [graphHistory])

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
    },
    scales: {
      y: { beginAtZero: true },
      y1: lineChartData ? { type: 'linear', position: 'right', grid: { drawOnChartArea: false } } : undefined,
    },
  }

  const toggleRegion = (id) => {
    setSelectedRegions(prev => 
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  const formatVolume = (v) => {
    if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T'
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K'
    return String(v)
  }

  const formatIsk = (v) => {
    if (v == null || typeof v !== 'number') return '—'
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K'
    return v.toLocaleString()
  }

  const months = useMemo(() => {
    // Day trade: data only from last month (single option)
    if (dataTab === 'daytrade') return [lastMonthOnly]
    const out = []
    const d = new Date()
    for (let i = 0; i < 12; i++) {
      const m = d.getMonth() - i
      const y = d.getFullYear() + Math.floor(m / 12)
      const mo = ((m % 12) + 12) % 12 + 1
      out.push(`${y}-${String(mo).padStart(2, '0')}`)
    }
    return out
  }, [dataTab, lastMonthOnly])

  return (
    <div className="app">
      <header className="header">
        <h1>EVE Trade Explorer</h1>
        <p className="subtitle">Market volume & top items by region • Data from ESI</p>
      </header>

      <section className="filters">
        <div className="filter-group">
          <label>Regions (trade hubs)</label>
          <div className="region-chips">
            {Object.entries(regions).map(([id, name]) => (
              <button
                key={id}
                className={`chip ${selectedRegions.includes(id) ? 'active' : ''}`}
                onClick={() => toggleRegion(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-group">
            <label>Month</label>
            <select value={month} onChange={e => setMonth(e.target.value)}>
              {months.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Dataset</label>
            <div className="view-tabs">
              <button className={dataTab === 'items' ? 'active' : ''} onClick={() => setDataTab('items')}>Items</button>
              <button className={dataTab === 'modules' ? 'active' : ''} onClick={() => setDataTab('modules')}>Ship modules</button>
              <button className={dataTab === 'ships' ? 'active' : ''} onClick={() => setDataTab('ships')}>Ships</button>
              <button className={dataTab === 'daytrade' ? 'active' : ''} onClick={() => setDataTab('daytrade')}>Day trade (Jita)</button>
            </div>
          </div>
          <div className="filter-group">
            {dataTab !== 'daytrade' && (
              <>
                <label>View</label>
                <div className="view-tabs">
                  <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>Table</button>
                  <button className={viewMode === 'graph' ? 'active' : ''} onClick={() => setViewMode('graph')}>Graph</button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="search-sort">
        <input
          type="text"
          placeholder="Search items or regions..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <div className="sort-controls">
          <label>Sort by</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="volume">Volume</option>
            <option value="order_count">Order count</option>
            {dataTab === 'modules' && (
              <>
                <option value="profit_margin_pct">Margin %</option>
                <option value="material_cost">Material cost</option>
                <option value="avg_price">Avg price</option>
              </>
            )}
            <option value="type_name">Item name</option>
            <option value="region_name">Region</option>
          </select>
          <button className="sort-dir" onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
            {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading">Loading market data...</div>}

      {!loading && !error && (
        <div key={dataTab}>
          <section className="top-section">
            <h2>
              {dataTab === 'daytrade' && 'Top 20 day trade — Jita (buy lowest, sell highest)'}
              {dataTab === 'modules' && 'Top 10 Ship Modules by Volume'}
              {dataTab === 'ships' && 'Top Ships Sold by Volume'}
              {dataTab === 'items' && 'Top 10 Items by Volume (Sold/Bought)'}
            </h2>
            <p className="hint">
              {dataTab === 'daytrade' && `Jita only. Data is from last month only${daytradeMonth ? ` (${daytradeMonth})` : ''}. Profit per unit = highest − lowest in that month.`}
              {dataTab === 'modules' && 'Common PvP/PvE ship modules by trade volume in selected regions.'}
              {dataTab === 'ships' && 'Ships sold by trade volume in selected regions. Frigates, destroyers, cruisers, battlecruisers, battleships.'}
              {dataTab === 'items' && 'Volume traded per month in selected regions. ESI combines buy/sell into total volume.'}
            </p>
          </section>

          {dataTab === 'daytrade' && (
            <>
              <div className="filter-group" style={{ marginBottom: '0.75rem' }}>
                <span className="view-tabs-label">Sort by:</span>
                <div className="view-tabs">
                  <button className={daytradeView === 'isk' ? 'active' : ''} onClick={() => setDaytradeView('isk')}>By profit (ISK)</button>
                  <button className={daytradeView === 'percent' ? 'active' : ''} onClick={() => setDaytradeView('percent')}>By profit (%)</button>
                </div>
              </div>
              <section className="table-section">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Item</th>
                      <th className="num">Lowest</th>
                      <th className="num">Highest</th>
                      <th className="num">Profit/unit</th>
                      <th className="num">Profit %</th>
                      <th className="num">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daytradeRows.map((row, i) => (
                      <tr key={row.type_id}>
                        <td>{i + 1}</td>
                        <td>{row.type_name}</td>
                        <td className="num">{formatIsk(row.lowest)}</td>
                        <td className="num">{formatIsk(row.highest)}</td>
                        <td className="num">{formatIsk(row.profit_per_unit)}</td>
                        <td className="num">{(row.profit_pct ?? 0).toFixed(1)}%</td>
                        <td className="num">{formatVolume(row.volume)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {daytradeRows.length === 0 && !loading && <p className="empty">No data. Day trade uses last month only.</p>}
              </section>
            </>
          )}

          {viewMode === 'table' && dataTab !== 'daytrade' && (
            <section className="table-section">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Region</th>
                    <th>Volume</th>
                    <th>Orders</th>
                    {dataTab === 'modules' && (
                      <>
                        <th className="num">Material cost</th>
                        <th className="num">Avg price</th>
                        <th className="num">Broker / tax</th>
                        <th className="num" title="Positive = profit, negative = loss">Margin %</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row, i) => (
                    <tr key={`${row.region_id}-${row.type_id}`}>
                      <td>{i + 1}</td>
                      <td>{row.type_name}</td>
                      <td>{row.region_name}</td>
                      <td className="num">{formatVolume(row.volume)}</td>
                      <td className="num">{row.order_count?.toLocaleString()}</td>
                      {dataTab === 'modules' && (
                        <>
                          <td className="num">{formatIsk(row.material_cost)}</td>
                          <td className="num">{formatIsk(row.avg_price)}</td>
                          <td className="num">{formatIsk((row.broker_fee ?? 0) + (row.tax ?? 0))}</td>
                          <td className={`num ${row.profit_margin_pct != null && row.profit_margin_pct < 0 ? 'negative' : ''}`}>
                            {row.profit_margin_pct != null
                              ? `${row.profit_margin_pct.toFixed(1)}%`
                              : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredData.length === 0 && <p className="empty">No data. Try different filters or refresh.</p>}
            </section>
          )}

          {viewMode === 'graph' && barChartData && (
            <section className="chart-section">
              <div className="chart-container">
                <Bar data={barChartData} options={chartOptions} />
              </div>
            </section>
          )}

          <section className="graph-form">
            <h3>Item History Graph</h3>
            <p className="hint">View daily volume & price for a specific item in a region.</p>
            <div className="graph-form-row">
              <div className="filter-group">
                <label>Region</label>
                <select value={graphRegion} onChange={e => setGraphRegion(e.target.value)}>
                  <option value="">Select region</option>
                  {Object.entries(regions).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="filter-group">
                <label>Item (type ID)</label>
                <input
                  type="number"
                  placeholder="e.g. 34 (Tritanium)"
                  value={graphTypeId}
                  onChange={e => setGraphTypeId(e.target.value)}
                />
              </div>
              <button className="btn-primary" onClick={fetchGraphHistory} disabled={!graphRegion || !graphTypeId}>
                Load Graph
              </button>
            </div>
            {lineChartData && (
              <div className="chart-container line-chart">
                <Line data={lineChartData} options={chartOptions} />
              </div>
            )}
          </section>
        </div>
      )}

      <footer className="footer">
        Data from <a href="https://esi.evetech.net/" target="_blank" rel="noopener noreferrer">EVE ESI</a>. 
        Market data is per region (NPC stations share regional markets). Cached 1hr.
      </footer>
    </div>
  )
}
