import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';

const execAsync = promisify(exec);

/**
 * CodeEditorService
 * Safe file system modifier, code reader, and shell command execution engine
 * for the Builder Agent.
 */
export class CodeEditorService {
  /**
   * @param {string} [workspaceRoot=process.cwd()] - Root workspace boundary
   */
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Enforces that paths never escape the workspace root directory.
   * @private
   */
  _resolveAndValidatePath(relativePath) {
    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    if (!absolutePath.startsWith(this.workspaceRoot)) {
      throw new HermesError(`Path traversal violation: [${relativePath}] escapes workspace boundary.`, {
        code: 'FS_PATH_TRAVERSAL_ABORTED',
        category: 'system',
        isRecoverable: false
      });
    }
    return absolutePath;
  }

  /**
   * Reads a file from the local filesystem.
   * @param {string} relativePath
   * @returns {Promise<string>}
   */
  async readFile(relativePath) {
    const absPath = this._resolveAndValidatePath(relativePath);
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      return content;
    } catch (error) {
      throw new HermesError(`Failed to read file [${relativePath}]: ${error.message}`, {
        code: 'FS_READ_ERROR',
        category: 'system',
        isRecoverable: true
      });
    }
  }

  /**
   * Writes content to a file, automatically creating parent directories if missing.
   * @param {string} relativePath
   * @param {string} content
   * @returns {Promise<void>}
   */
  async writeFile(relativePath, content) {
    const absPath = this._resolveAndValidatePath(relativePath);
    try {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, 'utf-8');
      logger.info(`[CodeEditorService] Successfully wrote file: ${relativePath}`);
    } catch (error) {
      throw new HermesError(`Failed to write file [${relativePath}]: ${error.message}`, {
        code: 'FS_WRITE_ERROR',
        category: 'system',
        isRecoverable: true
      });
    }
  }

  /**
   * Applies exact string replacement inside a target file.
   * @param {string} relativePath
   * @param {string} targetContent
   * @param {string} replacementContent
   * @returns {Promise<boolean>} True if replacement succeeded
   */
  async replaceContent(relativePath, targetContent, replacementContent) {
    const content = await this.readFile(relativePath);
    if (!content.includes(targetContent)) {
      throw new HermesError(`Target substring not found in file [${relativePath}]`, {
        code: 'FS_REPLACE_TARGET_MISSING',
        category: 'system',
        isRecoverable: true
      });
    }
    const updated = content.replace(targetContent, replacementContent);
    await this.writeFile(relativePath, updated);
    return true;
  }

  /**
   * Executes a shell command inside the workspace directory.
   * @param {string} command
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<{ stdout: string, stderr: string }>}
   */
  async runCommand(command, timeoutMs = 30000) {
    logger.debug(`[CodeEditorService] Executing shell command: "${command}"`);
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceRoot,
        timeout: timeoutMs
      });
      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      throw new HermesError(`Command execution failed [${command}]: ${error.message || error.stderr}`, {
        code: 'SHELL_EXEC_ERROR',
        category: 'system',
        isRecoverable: true,
        metadata: { stdout: error.stdout, stderr: error.stderr }
      });
    }
  }
}
