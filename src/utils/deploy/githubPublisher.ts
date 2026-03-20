/**
 * --- GITHUB PUBLISHER -------------------------------------------------------
 * Publishes the current project to a GitHub repository using the GitHub
 * Trees API. Generates all project files via codeGenerator.ts, encodes them
 * as base64 blobs, creates a single Git tree in one API call, then commits
 * and pushes to the target branch.
 */

const GH_API = 'https://api.github.com';

// ─── PUBLIC TYPES ─────────────────────────────────────────────────────────────

export interface GitHubPublishConfig {
    /** Personal Access Token. Classic: needs `repo`. Fine-grained: Contents R+W. */
    pat: string;
    /** GitHub username or organisation owning the repository. */
    owner: string;
    /** Repository name. Must already exist — Vectra does not create repos. */
    repo: string;
    /** Branch to push to. Created from default branch if not found. */
    branch: string;
    /** Git commit message shown in the repo timeline. */
    commitMessage: string;
}

export interface GitHubPublishResult {
    commitUrl: string;
    commitSha: string;
    repoUrl: string;
    filesPublished: number;
    branchCreated: boolean;
}

export type GitHubPublishPhase = 'blobs' | 'tree' | 'commit' | 'ref';

export interface GitHubPublishProgress {
    phase: GitHubPublishPhase;
    blobsDone?: number;
    blobsTotal?: number;
}

// ─── INTERNAL: GitHub API fetch wrapper ───────────────────────────────────────

async function ghFetch(
    pat: string,
    method: string,
    path: string,
    body?: unknown
): Promise<any> {
    const res = await fetch(`${GH_API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${pat}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (res.status === 204) return null;

    const json = await res.json().catch(() => ({ message: res.statusText }));

    if (!res.ok) {
        throw new Error(
            `GitHub ${method} ${path} → ${res.status}: ${json.message ?? res.statusText}`
        );
    }

    return json;
}

// ─── STEP 1: Resolve parent commit + tree ─────────────────────────────────────

interface ParentState {
    parentSha: string;
    parentTreeSha: string;
    branchCreated: boolean;
}

async function resolveParent(
    pat: string,
    owner: string,
    repo: string,
    branch: string
): Promise<ParentState> {
    // ── Try target branch ────────────────────────────────────────────────────
    try {
        const ref = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
        const commit = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
        return { parentSha: ref.object.sha, parentTreeSha: commit.tree.sha, branchCreated: false };
    } catch (e: any) {
        if (!e.message.includes('404') && !e.message.includes('Not Found')) throw e;
    }

    // ── Branch not found — get default branch ────────────────────────────────
    try {
        const repoMeta = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}`);
        const defaultBranch: string = repoMeta.default_branch ?? 'main';
        const defaultRef = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`);
        const parentSha: string = defaultRef.object.sha;
        const commit = await ghFetch(pat, 'GET', `/repos/${owner}/${repo}/git/commits/${parentSha}`);

        // Create target branch pointing at parent commit
        await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/refs`, {
            ref: `refs/heads/${branch}`,
            sha: parentSha,
        });

        return { parentSha, parentTreeSha: commit.tree.sha, branchCreated: true };
    } catch (e: any) {
        const isEmptyRepo =
            e.message.includes('empty') ||
            e.message.includes('409') ||
            e.message.includes('Git Repository is empty');
        if (!isEmptyRepo) throw e;
    }

    // ── Empty repo — no parent commit, no base tree ──────────────────────────
    return { parentSha: '', parentTreeSha: '', branchCreated: true };
}

// ─── STEP 2: Create blobs in parallel ─────────────────────────────────────────

/** UTF-8-safe base64 encoding — btoa() alone breaks on non-Latin characters. */
function toBase64(content: string): string {
    return btoa(unescape(encodeURIComponent(content)));
}

async function createBlobs(
    pat: string,
    owner: string,
    repo: string,
    files: Record<string, string>,
    onProgress?: (p: GitHubPublishProgress) => void
): Promise<Array<{ path: string; sha: string }>> {
    const entries = Object.entries(files);
    let done = 0;

    return Promise.all(
        entries.map(async ([path, content]) => {
            const blob = await ghFetch(
                pat, 'POST', `/repos/${owner}/${repo}/git/blobs`,
                { content: toBase64(content), encoding: 'base64' }
            );
            done++;
            onProgress?.({ phase: 'blobs', blobsDone: done, blobsTotal: entries.length });
            return { path, sha: blob.sha as string };
        })
    );
}

// ─── STEP 3: Create tree ──────────────────────────────────────────────────────

async function createTree(
    pat: string,
    owner: string,
    repo: string,
    blobs: Array<{ path: string; sha: string }>,
    baseTreeSha: string
): Promise<string> {
    const tree = blobs.map(({ path, sha }) => ({
        path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha,
    }));

    const body: Record<string, unknown> = { tree };
    if (baseTreeSha) body.base_tree = baseTreeSha;

    const result = await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/trees`, body);
    return result.sha as string;
}

// ─── STEP 4: Create commit ────────────────────────────────────────────────────

async function createCommit(
    pat: string,
    owner: string,
    repo: string,
    message: string,
    treeSha: string,
    parentSha: string
): Promise<string> {
    const body: Record<string, unknown> = { message, tree: treeSha };
    if (parentSha) body.parents = [parentSha];

    const commit = await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/commits`, body);
    return commit.sha as string;
}

// ─── STEP 5: Update or create branch ref ──────────────────────────────────────

async function updateBranchRef(
    pat: string,
    owner: string,
    repo: string,
    branch: string,
    commitSha: string,
    branchCreated: boolean
): Promise<void> {
    if (!branchCreated) {
        await ghFetch(pat, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
            sha: commitSha,
            force: false,
        });
        return;
    }

    try {
        await ghFetch(pat, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
            sha: commitSha,
            force: true,
        });
    } catch {
        await ghFetch(pat, 'POST', `/repos/${owner}/${repo}/git/refs`, {
            ref: `refs/heads/${branch}`,
            sha: commitSha,
        });
    }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * publishToGitHub
 * ───────────────
 * Pushes a flat Record<path, content> file map to a GitHub repository
 * as a single atomic commit using the Git Trees API.
 *
 * @param files      Path → file content map (from generateNextProjectCode / generateProjectCode)
 * @param config     PAT, owner, repo, branch, commit message
 * @param onProgress Optional callback for UI progress updates
 * @throws Error with a human-readable GitHub API error message on failure.
 */
export async function publishToGitHub(
    files: Record<string, string>,
    config: GitHubPublishConfig,
    onProgress?: (p: GitHubPublishProgress) => void
): Promise<GitHubPublishResult> {
    const { pat, owner, repo, branch, commitMessage } = config;

    if (!pat.trim()) throw new Error('Personal Access Token is required.');
    if (!owner.trim()) throw new Error('Repository owner (username or org) is required.');
    if (!repo.trim()) throw new Error('Repository name is required.');
    if (!branch.trim()) throw new Error('Branch name is required.');
    if (Object.keys(files).length === 0) throw new Error('No files to publish — generate project first.');

    const { parentSha, parentTreeSha, branchCreated } =
        await resolveParent(pat, owner, repo, branch);

    onProgress?.({ phase: 'blobs', blobsDone: 0, blobsTotal: Object.keys(files).length });
    const blobs = await createBlobs(pat, owner, repo, files, onProgress);

    onProgress?.({ phase: 'tree' });
    const treeSha = await createTree(pat, owner, repo, blobs, parentTreeSha);

    onProgress?.({ phase: 'commit' });
    const commitSha = await createCommit(
        pat, owner, repo,
        commitMessage || 'Publish from Vectra Visual Builder',
        treeSha, parentSha
    );

    onProgress?.({ phase: 'ref' });
    await updateBranchRef(pat, owner, repo, branch, commitSha, branchCreated);

    return {
        commitUrl: `https://github.com/${owner}/${repo}/commit/${commitSha}`,
        commitSha,
        repoUrl: `https://github.com/${owner}/${repo}/tree/${branch}`,
        filesPublished: Object.keys(files).length,
        branchCreated,
    };
}
