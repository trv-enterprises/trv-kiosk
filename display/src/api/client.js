// Voice Display API Client
// Simplified version of dashboard API client

// Get API base URL from environment or use defaults
const getApiBaseUrl = () => {
  // Always prefer explicit environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }

  // Default: point to your dashboard server
  return 'http://YOUR_DASHBOARD_SERVER:3001'
}

const API_BASE_URL = getApiBaseUrl()

export const API_BASE = API_BASE_URL

class APIClient {
  constructor(baseURL = API_BASE_URL) {
    this.baseURL = baseURL
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    const config = {
      headers,
      ...options,
    }

    try {
      const response = await fetch(url, config)

      if (response.status === 204) {
        return { success: true }
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`)
      }

      return data
    } catch (error) {
      console.error('API Error:', error)
      throw error
    }
  }

  // Health check
  async health() {
    return this.request('/health')
  }

  // Dashboard endpoints
  async getDashboards(filters = {}) {
    const params = new URLSearchParams(filters)
    return this.request(`/api/dashboards?${params}`)
  }

  async getDashboard(id) {
    return this.request(`/api/dashboards/${id}`)
  }

  // Chart endpoints
  async getCharts(filters = {}) {
    const params = new URLSearchParams(filters)
    return this.request(`/api/charts?${params}`)
  }

  async getChart(id) {
    return this.request(`/api/charts/${id}`)
  }

  // Connection endpoints
  async getConnections(filters = {}) {
    const params = new URLSearchParams(filters)
    return this.request(`/api/connections?${params}`)
  }

  async getConnection(id) {
    return this.request(`/api/connections/${id}`)
  }

  async queryConnection(id, query) {
    return this.request(`/api/connections/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
  }

  // Aliases for compatibility
  async getDatasource(id) {
    return this.getConnection(id)
  }

  // Server URL configuration
  setServerUrl(url) {
    this.baseURL = url
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('serverUrl', url)
    }
  }

  getServerUrl() {
    return this.baseURL
  }

  restoreServerUrl() {
    if (typeof localStorage !== 'undefined') {
      const savedUrl = localStorage.getItem('serverUrl')
      if (savedUrl) {
        this.baseURL = savedUrl
      }
    }
  }
}

const client = new APIClient()
export default client
