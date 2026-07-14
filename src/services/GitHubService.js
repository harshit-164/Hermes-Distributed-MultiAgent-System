import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';
import { withRetry } from '../utils/retry.js';

/**
 * GitHubService
 * Provides resilient, rate-limit-protected exploration of GitHub repositories,
 * documentation markdown, and architecture issues for the Research Agent.
 */
export class GitHubService {
  /**
   * @param {string} [githubToken] - Optional GitHub Personal Access Token for higher rate limits
   */
  constructor(githubToken = process.env.GITHUB_TOKEN || '') {
    this.token = githubToken;
    this.baseUrl = 'https://api.github.com';
  }

  /**
   * Helper to construct API headers.
   * @private
   */
  _getHeaders() {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Hermes-V2-Research-Agent'
    };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }
    return headers;
  }

  /**
   * Searches public GitHub repositories matching a query string.
   * @param {string} query - Keyword search e.g., 'distributed ai agent supabase'
   * @param {number} [limit=5]
   * @returns {Promise<Array<object>>}
   */
  async searchRepositories(query, limit = 5) {
    return withRetry(async () => {
      const url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${limit}`;
      const response = await fetch(url, { headers: this._getHeaders() });

      if (!response.ok) {
        throw new HermesError(`GitHub API search failed: ${response.status} ${response.statusText}`, {
          code: 'GITHUB_SEARCH_ERROR',
          category: 'system',
          isRecoverable: response.status >= 500 || response.status === 429
        });
      }

      const data = await response.json();
      const repos = (data.items || []).map(repo => ({
        name: repo.full_name,
        description: repo.description,
        stars: repo.stargazers_count,
        url: repo.html_url,
        defaultBranch: repo.default_branch
      }));

      logger.debug(`Found ${repos.length} GitHub repositories for query: "${query}"`);
      return repos;
    }, { operationName: 'searchGitHubRepositories' });
  }

  /**
   * Fetches raw README content of a GitHub repository (`owner/repo`).
   * @param {string} fullName - e.g. 'supabase/supabase'
   * @returns {Promise<string>}
   */
  async fetchReadme(fullName) {
    return withRetry(async () => {
      const url = `${this.baseUrl}/repos/${fullName}/readme`;
      const response = await fetch(url, { headers: this._getHeaders() });

      if (!response.ok) {
        if (response.status === 404) {
          return 'No README found for this repository.';
        }
        throw new HermesError(`Failed to fetch README for [${fullName}]: ${response.status}`, {
          code: 'GITHUB_README_ERROR',
          category: 'system',
          isRecoverable: response.status >= 500 || response.status === 429
        });
      }

      const data = await response.json();
      if (!data.content) return 'Empty README content.';

      // GitHub returns base64 encoded string with newlines
      const rawMarkdown = Buffer.from(data.content, 'base64').toString('utf-8');
      return rawMarkdown.substring(0, 5000); // Truncate to first 5000 chars for clean synthesis
    }, { operationName: 'fetchGitHubReadme' });
  }

  /**
   * Synthesizes technical insights from repositories and documentation into a structured summary.
   * @param {string} topic
   * @param {Array<object>} repos
   * @returns {object} Structured research summary
   */
  synthesizeInsights(topic, repos) {
    const keyArchitectures = repos.map(r => ({
      name: r.name,
      takeaway: `Best practices from ${r.name} (${r.stars} stars): ${r.description || 'Modern architectural patterns'}`
    }));

    return {
      topic,
      timestamp: new Date().toISOString(),
      sourceRepositoriesCount: repos.length,
      recommendations: [
        `Adopt modular layered architecture with clean separation between core state and external services based on findings in ${topic}.`,
        `Enforce strict typing and Zod/JSON schema validation across boundaries.`,
        `Implement exponential backoff retry mechanisms to handle distributed latency.`
      ],
      repositories: keyArchitectures
    };
  }
}
