import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';
import { validateDB } from '../lib/validation.js';
const digest = s => createHash('sha256').update(s).digest();
const authorized = (header, password) => typeof header==='string' && header.startsWith('Bearer ') && timingSafeEqual(digest(header.slice(7)),digest(password));
function checkLimits(db){
  if(db.employees.length>20000||db.leaves.length>100000) throw Error('Jumlah data melampaui kapasitas aplikasi ini.');
  for(const e of db.employees){if(e.nik.length>120)throw Error('NIK terlalu panjang.');for(const v of Object.values(e))if(typeof v==='string'&&v.length>1000)throw Error('Isian profil terlalu panjang.');}
  for(const l of db.leaves){if(l.id.length>120||l.reason.length>2000)throw Error('ID atau keperluan terlalu panjang (maksimum 2.000 karakter).');for(const [k,v] of Object.entries(l))if(k!=='reason'&&typeof v==='string'&&v.length>1000)throw Error('Isian izin terlalu panjang.');}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','PUT'].includes(req.method)){res.setHeader('Allow','GET, PUT');return res.status(405).json({error:'Metode tidak diizinkan.'});}
  const password=process.env.APP_PASSWORD, url=process.env.DATABASE_URL;
  if(!password||password.length<16||!url)return res.status(503).json({error:'Konfigurasi server belum lengkap. Atur DATABASE_URL dan APP_PASSWORD (minimal 16 karakter).'});
  if(!authorized(req.headers.authorization,password))return res.status(401).json({error:'Kata sandi akses salah.'});
  try{
    const sql=neon(url);
    if(req.method==='GET'){
      const [r]=await sql`SELECT revision, jsonb_build_object('version',1,'employees',COALESCE((SELECT jsonb_agg(data ORDER BY nik) FROM personnel_desk.employees),'[]'::jsonb),'leaves',COALESCE((SELECT jsonb_agg(data ORDER BY id) FROM personnel_desk.leaves),'[]'::jsonb)) AS db FROM personnel_desk.state WHERE singleton`;
      if(!r)throw Error('Schema not initialized');
      return res.status(200).json(r);
    }
    let body,db;try{
      if(!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('Gunakan format JSON.');
      body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.restore!=='boolean')throw Error('Permintaan tidak valid.');
      if(Buffer.byteLength(JSON.stringify(body),'utf8')>4_000_000)throw Error('Ukuran data melebihi 4 MB per transaksi.');
      db=validateDB(body.db);checkLimits(db);
    }catch(e){return res.status(400).json({error:e.message});}
    const [r]=await sql`SELECT personnel_desk.save_database(${body.revision}::integer,${JSON.stringify(db)}::jsonb,${body.restore}::boolean) AS revision`;
    if(r.revision===-1)return res.status(409).json({error:'Data telah berubah di perangkat lain. Tutup formulir, klik Muat ulang, lalu ulangi perubahan agar data terbaru tidak tertimpa.'});
    return res.status(200).json({revision:r.revision});
  }catch(e){console.error('Personnel Desk database error:',e.code||e.name);return res.status(503).json({error:'Neon Database tidak dapat diakses. Periksa DATABASE_URL, jalankan schema.sql, atau coba lagi. Data belum dikonfirmasi tersimpan.'});}
}
