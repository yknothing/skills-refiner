const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;

const definitions = {
  loopos: {
    repositoryId: 'yknothing/loopos',
    sourceUrl: 'https://github.com/yknothing/loopos.git',
    members: [
      'loopos', 'loopos-accept', 'loopos-benchmark', 'loopos-compile', 'loopos-doctor',
      'loopos-goal', 'loopos-improve', 'loopos-recover', 'loopos-review', 'loopos-run',
    ].map((name) => ({ name, sourcePath: `skills/${name}` })),
    compatibleMemberProfiles: [],
    rejectedMembers: [],
    manifestPath: 'pyproject.toml',
    exposure: { type: 'gateway', name: 'loopos' },
    preservedNames: [],
    sharedPaths: [],
    compatibleSharedPathProfiles: [],
    referenceExclusions: [],
  },
  langcraft: {
    repositoryId: 'yknothing/langcraft',
    sourceUrl: 'https://github.com/yknothing/langcraft.git',
    members: [
      { name: 'langcraft', sourcePath: 'skills/langcraft-router' },
      { name: 'philosophical-discourse', sourcePath: 'skills/philosophical-discourse' },
      { name: 'prose-craft', sourcePath: 'skills/prose-craft' },
      { name: 'script-craft', sourcePath: 'skills/script-craft' },
      { name: 'tech-writing', sourcePath: 'skills/tech-writing' },
      { name: 'translation', sourcePath: 'skills/translation' },
    ],
    compatibleMemberProfiles: [],
    rejectedMembers: [],
    manifestPath: 'README.md',
    exposure: { type: 'gateway', name: 'langcraft' },
    preservedNames: [],
    sharedPaths: [],
    compatibleSharedPathProfiles: [],
    referenceExclusions: [],
  },
  'better-skills': {
    repositoryId: 'yknothing/better-skills',
    sourceUrl: 'https://github.com/yknothing/better-skills.git',
    members: [
      'bs-article-illustrate', 'bs-dev-flow', 'bs-first-customer-finder',
      'bs-prose-craft', 'bs-requirements-engineering', 'bs-skill-bootstrap',
      'bs-skill-health', 'bs-social-card',
    ].map((name) => ({ name, sourcePath: `skills/${name}` })),
    compatibleMemberProfiles: [[
      'bs-article-illustrate', 'bs-dev-flow', 'bs-first-customer-finder',
      'bs-prose-craft', 'bs-requirements-engineering', 'bs-skill-bootstrap',
      'bs-skill-health', 'bs-social-card', 'bs-visual-design',
    ].map((name) => ({ name, sourcePath: `skills/${name}` }))],
    rejectedMembers: [{
      name: 'bs-visual-design', sourcePath: 'skills/bs-visual-design',
      reason: 'invalid_portable_yaml',
    }],
    manifestPath: 'skills.json',
    exposure: { type: 'collection', name: 'better-skills' },
    preservedNames: [
      'article-illustrate', 'dev-flow', 'first-customer-finder', 'prose-craft',
      'requirements-engineering', 'skill-bootstrap', 'skill-health', 'social-card',
      'visual-design',
    ],
    sharedPaths: ['docs/patterns', 'docs/research', 'tools/check-patterns.sh', 'skills.json'],
    compatibleSharedPathProfiles: [['docs/patterns']],
    referenceExclusions: [
      'docs/patterns/04-context-management/load-stub.md',
      'docs/patterns/04-context-management/progressive-disclosure.md',
      'docs/patterns/_schema.md',
      'docs/patterns/_template.md',
    ],
  },
};

function freezeSpec(collectionId, value) {
  if (!NAME.test(collectionId) || !NAME.test(value.exposure.name)
      || !['gateway', 'collection'].includes(value.exposure.type)
      || typeof value.repositoryId !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repositoryId)
      || value.sourceUrl.toLowerCase() !== `https://github.com/${value.repositoryId}.git`.toLowerCase()
      || !RELATIVE_PATH.test(value.manifestPath)) throw new Error(`invalid collection spec: ${collectionId}`);
  const members = value.members.map((member) => Object.freeze({ ...member }));
  const compatibleMemberProfiles = value.compatibleMemberProfiles.map((profile) => profile.map((member) => Object.freeze({ ...member })));
  const rejectedMembers = value.rejectedMembers.map((member) => Object.freeze({ ...member }));
  const invalidMemberProfile = (profile) => new Set(profile.map(({ name }) => name)).size !== profile.length
    || new Set(profile.map(({ sourcePath }) => sourcePath)).size !== profile.length
    || profile.some(({ name, sourcePath }) => !NAME.test(name) || !RELATIVE_PATH.test(sourcePath));
  if (invalidMemberProfile(members) || compatibleMemberProfiles.some(invalidMemberProfile)
      || invalidMemberProfile(rejectedMembers)
      || rejectedMembers.some(({ name, sourcePath, reason }) => reason !== 'invalid_portable_yaml'
        || members.some((member) => member.name === name || member.sourcePath === sourcePath))) {
    throw new Error(`invalid member set: ${collectionId}`);
  }
  const preservedNames = [...value.preservedNames];
  const sharedPaths = [...value.sharedPaths];
  const compatibleSharedPathProfiles = value.compatibleSharedPathProfiles.map((profile) => [...profile]);
  const referenceExclusions = [...value.referenceExclusions];
  if (new Set(preservedNames).size !== preservedNames.length || preservedNames.some((name) => !NAME.test(name) || members.some((member) => member.name === name))
      || new Set(sharedPaths).size !== sharedPaths.length || sharedPaths.some((path) => !RELATIVE_PATH.test(path))
      || sharedPaths.some((path, index) => sharedPaths.some((other, otherIndex) => index !== otherIndex && (path.startsWith(`${other}/`) || other.startsWith(`${path}/`))))
      || compatibleSharedPathProfiles.some((profile) => !Array.isArray(profile)
        || new Set(profile).size !== profile.length
        || profile.some((path) => !RELATIVE_PATH.test(path) || !sharedPaths.includes(path))
        || profile.some((path, index) => profile.some((other, otherIndex) => index !== otherIndex && (path.startsWith(`${other}/`) || other.startsWith(`${path}/`)))))
      || new Set(referenceExclusions).size !== referenceExclusions.length
      || referenceExclusions.some((path) => !RELATIVE_PATH.test(path)
        || !sharedPaths.some((sharedPath) => path.startsWith(`${sharedPath}/`)))) {
    throw new Error(`invalid aliases or shared paths: ${collectionId}`);
  }
  if (value.exposure.type === 'gateway' && !members.some(({ name }) => name === value.exposure.name)) throw new Error(`gateway is not a member: ${collectionId}`);
  if (value.exposure.type === 'collection' && value.exposure.name !== collectionId) throw new Error(`collection exposure must use collection id: ${collectionId}`);
  return Object.freeze({
    collectionId,
    ...value,
    members: Object.freeze(members),
    memberProfiles: Object.freeze([
      ...compatibleMemberProfiles.map((profile) => Object.freeze(profile)),
      Object.freeze([...members]),
    ]),
    rejectedMembers: Object.freeze(rejectedMembers),
    exposure: Object.freeze({ ...value.exposure }),
    preservedNames: Object.freeze(preservedNames),
    sharedPaths: Object.freeze(sharedPaths),
    sharedPathProfiles: Object.freeze([
      ...compatibleSharedPathProfiles.map((profile) => Object.freeze(profile)),
      Object.freeze([...sharedPaths]),
    ]),
    referenceExclusions: Object.freeze(referenceExclusions),
  });
}

export const COLLECTION_SPECS = Object.freeze(Object.fromEntries(
  Object.entries(definitions).map(([collectionId, value]) => [collectionId, freezeSpec(collectionId, value)]),
));

export function collectionSpec(collectionId) {
  const spec = COLLECTION_SPECS[collectionId];
  if (!spec) throw new Error(`unsupported managed collection: ${collectionId}`);
  return spec;
}

export function managedCollectionIds() {
  return Object.keys(COLLECTION_SPECS).sort();
}
