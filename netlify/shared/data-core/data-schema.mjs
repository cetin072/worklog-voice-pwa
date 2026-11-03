// One opt-in database namespace for every server Data API consumer.
export function worklogDataSchema(readEnv = name => globalThis.Netlify?.env?.get(name) ?? globalThis.process?.env?.[name]) {
  const value = String(readEnv('WORKLOG_DATA_SCHEMA') || 'public').trim();
  if (!['public','worklog'].includes(value)) throw new Error('WORKLOG_DATA_SCHEMA_INVALID');
  return value;
}
export function dataSchemaHeaders(schema = worklogDataSchema()) {
  if (!['public','worklog'].includes(schema)) throw new Error('WORKLOG_DATA_SCHEMA_INVALID');
  return schema === 'public' ? {} : {'Accept-Profile': schema, 'Content-Profile': schema};
}
