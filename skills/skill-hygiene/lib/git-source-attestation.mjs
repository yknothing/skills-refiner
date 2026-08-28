export function originTrackingRefsContaining(git, revision) {
  const observed = git(
    'for-each-ref', `--contains=${revision}`, '--format=%(refname)', 'refs/remotes/origin',
  );
  if (observed.status !== 0) return { ok: false, refs: [] };
  const refs = observed.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.startsWith('refs/remotes/origin/')
      && value !== 'refs/remotes/origin/HEAD')
    .sort((left, right) => left.localeCompare(right, 'en'));
  return { ok: true, refs };
}
