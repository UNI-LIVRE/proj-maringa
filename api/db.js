/* Conexão com o MongoDB.
   - coleção "registros": um documento por registro de campo (GeoJSON Feature)
   - GridFS "fotos": as imagens (coleções fotos.files e fotos.chunks) */
const { MongoClient, GridFSBucket } = require('mongodb');

async function conectar(uri, nomeBanco) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(nomeBanco);
  const registros = db.collection('registros');
  const fotos = new GridFSBucket(db, { bucketName: 'fotos' });
  const usuarios = db.collection('usuarios');
  const sessoes = db.collection('sessoes');

  // índices (criá-los de novo não faz nada se já existirem)
  await registros.createIndexes([
    // consultas espaciais: "registros dentro desta sub-bacia", "a menos de 500 m daqui"…
    { key: { geometry: '2dsphere' }, name: 'geometry_2dsphere' },
    { key: { 'properties.excluido': 1, 'properties.atualizadoEm': -1 }, name: 'ativos_recentes' },
  ]);
  await usuarios.createIndexes([{ key: { email: 1 }, name: 'email_unico', unique: true }]);
  await sessoes.createIndexes([
    // o próprio MongoDB apaga as sessões vencidas
    { key: { expiraEm: 1 }, name: 'expira_ttl', expireAfterSeconds: 0 },
    { key: { usuarioId: 1 }, name: 'por_usuario' },
  ]);

  return { client, db, registros, fotos, usuarios, sessoes };
}

/** Documento do Mongo → formato usado pelo navegador (troca _id por id). */
function paraFeature(doc) {
  if (!doc) return null;
  return { type: 'Feature', id: doc._id, geometry: doc.geometry || null, properties: doc.properties || {} };
}

module.exports = { conectar, paraFeature };
