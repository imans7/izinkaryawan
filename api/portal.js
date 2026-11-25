import { neon } from '@neondatabase/serverless';
import QRCode from 'qrcode';
import { createHmac, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const ROLES = new Set(['admin','hrd','manager','employee']);
const STATUS = new Set(['menunggu_hrd','menunggu_manager','disetujui','ditolak']);
const clean = v => String(v ?? '').trim();
const todayJakarta = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const timeJakarta = () => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
const json = (res,status,payload) => res.status(status).json(payload);
const sqlClient = () => { if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum dikonfigurasi.'); return neon(process.env.DATABASE_URL); };
const sessionSecret = () => { const s=process.env.SESSION_SECRET || process.env.APP_PASSWORD || process.env.ADMIN_PASSWORD; if(!s || s.length<16) throw new Error('Atur SESSION_SECRET (minimal 32 karakter) atau APP_PASSWORD/ADMIN_PASSWORD yang kuat (minimal 16 karakter).'); return s; };
const sign = value => createHmac('sha256',sessionSecret()).update(value).digest('base64url');
const makeToken = user => { const payload=Buffer.from(JSON.stringify({uid:user.id,exp:Date.now()+12*60*60*1000})).toString('base64url'); return `${payload}.${sign(payload)}`; };
const cookieHeader = (req,value,maxAge) => { const secure=process.env.VERCEL || req.headers['x-forwarded-proto']==='https'; return `pd_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`; };
function getCookie(req,name){const raw=req.headers.cookie||'';for(const p of raw.split(';')){const i=p.indexOf('=');if(i>0&&p.slice(0,i).trim()===name)return decodeURIComponent(p.slice(i+1).trim());}return '';}
function verifyToken(token){try{const [payload,sig]=token.split('.');if(!payload||!sig)return null;const expected=Buffer.from(sign(payload));const actual=Buffer.from(sig);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(!data.uid||data.exp<Date.now())return null;return data;}catch{return null;}}
async function hashPassword(password,salt=randomBytes(16).toString('hex')){const derived=await scrypt(password,salt,64);return {salt,hash:Buffer.from(derived).toString('hex')};}
async function checkPassword(password,salt,stored){try{const got=Buffer.from(await scrypt(password,salt,64));const want=Buffer.from(stored,'hex');return got.length===want.length&&timingSafeEqual(got,want);}catch{return false;}}
function parseBody(req){if(typeof req.body==='string')return JSON.parse(req.body||'{}');return req.body||{};}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}}
async function bootstrapAdmin(sql){const [count]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users WHERE role='admin'`;if(Number(count.n)>0)return;const username=clean(process.env.ADMIN_USERNAME||'admin').toLowerCase();const password=process.env.ADMIN_PASSWORD||process.env.APP_PASSWORD;if(!password||password.length<16)throw new Error('Belum ada admin. Atur ADMIN_PASSWORD (minimal 16 karakter) atau APP_PASSWORD lama untuk membuat akun awal.');const fullName=clean(process.env.ADMIN_NAME||'Administrator');const h=await hashPassword(password);await sql`INSERT INTO personnel_desk.users(username,full_name,role,password_salt,password_hash) VALUES(${username},${fullName},'admin',${h.salt},${h.hash}) ON CONFLICT(username) DO NOTHING`;}
async function sessionUser(sql,req){const token=verifyToken(getCookie(req,'pd_session'));if(!token)return null;const [u]=await sql`SELECT id,username,full_name,role,employee_nik,is_active FROM personnel_desk.users WHERE id=${token.uid}::uuid`;if(!u||!u.is_active)return null;let employee=null;if(u.employee_nik){const [e]=await sql`SELECT data FROM personnel_desk.employees WHERE nik=${u.employee_nik}`;employee=e?.data||null;}return {...u,employee};}
function requireRole(user,...roles){if(!user)throw Object.assign(new Error('Sesi login tidak ditemukan. Silakan masuk kembali.'),{status:401});if(!roles.includes(user.role))throw Object.assign(new Error('Anda tidak memiliki izin untuk melakukan tindakan ini.'),{status:403});}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function validateRequestInput(body){const requestDate=clean(body.request_date)||todayJakarta(),returnTime=clean(body.return_time),reason=clean(body.reason),whatsapp=clean(body.whatsapp);if(!validDate(requestDate))throw Object.assign(new Error('Tanggal pengajuan tidak valid.'),{status:400});if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(returnTime))throw Object.assign(new Error('Jam kembali wajib diisi dengan format HH:MM.'),{status:400});if(requestDate===todayJakarta()&&returnTime<=timeJakarta())throw Object.assign(new Error('Jam kembali harus lebih besar dari jam keluar otomatis saat ini.'),{status:400});if(!reason||reason.length>2000)throw Object.assign(new Error('Keperluan wajib diisi (maksimal 2.000 karakter).'),{status:400});if(whatsapp.replace(/\D/g,'').length<8||whatsapp.length>40)throw Object.assign(new Error('Nomor WhatsApp tidak valid.'),{status:400});return {requestDate,returnTime,reason,whatsapp};}
async function ensurePublicForm(sql){const [r]=await sql`SELECT value FROM personnel_desk.settings WHERE key='public_form_enabled'`;return r?.value===true;}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  const url=new URL(req.url,`https://${req.headers.host||'localhost'}`);
  const action=url.searchParams.get('action')||'';
  if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Metode tidak diizinkan.'});
  if(req.method==='POST'&&!sameOrigin(req))return json(res,403,{error:'Permintaan lintas situs ditolak.'});
  let sql;
  try{sql=sqlClient();}catch(e){return json(res,503,{error:e.message});}
  try{
    if(req.method==='POST'){
      const body=parseBody(req);
      if(action==='login'){
        await bootstrapAdmin(sql);
        const username=clean(body.username).toLowerCase(),password=String(body.password||'');
        if(!username||!password)return json(res,400,{error:'Username dan password wajib diisi.'});
        const ip=clean(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
        const attemptKey=createHash('sha256').update(ip+'|'+username).digest('hex');
        const [limit]=await sql`SELECT blocked_until FROM personnel_desk.auth_attempts WHERE attempt_key=${attemptKey}`;
        if(limit?.blocked_until&&new Date(limit.blocked_until)>new Date())return json(res,429,{error:'Terlalu banyak percobaan login. Coba lagi setelah 15 menit.'});
        const [u]=await sql`SELECT id,username,full_name,role,employee_nik,password_salt,password_hash,is_active FROM personnel_desk.users WHERE username=${username}`;
        if(!u||!u.is_active||!(await checkPassword(password,u.password_salt,u.password_hash))){
          await sql`INSERT INTO personnel_desk.auth_attempts(attempt_key,fail_count,window_started_at,blocked_until) VALUES(${attemptKey},1,now(),NULL) ON CONFLICT(attempt_key) DO UPDATE SET fail_count=CASE WHEN personnel_desk.auth_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE personnel_desk.auth_attempts.fail_count+1 END,window_started_at=CASE WHEN personnel_desk.auth_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE personnel_desk.auth_attempts.window_started_at END,blocked_until=CASE WHEN (CASE WHEN personnel_desk.auth_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE personnel_desk.auth_attempts.fail_count+1 END)>=8 THEN now()+interval '15 minutes' ELSE NULL END`;
          return json(res,401,{error:'Username atau password salah.'});
        }
        await sql`DELETE FROM personnel_desk.auth_attempts WHERE attempt_key=${attemptKey}`;
        const token=makeToken(u);res.setHeader('Set-Cookie',cookieHeader(req,token,12*60*60));
        return json(res,200,{user:{id:u.id,username:u.username,full_name:u.full_name,role:u.role,employee_nik:u.employee_nik}});
      }
      if(action==='logout'){res.setHeader('Set-Cookie',cookieHeader(req,'',0));return json(res,200,{ok:true});}
      const user=await sessionUser(sql,req);
      if(action==='profile-save'){
        requireRole(user,'admin','hrd','manager','employee');const fullName=clean(body.full_name);if(!fullName||fullName.length>180)return json(res,400,{error:'Nama profil wajib diisi (maksimal 180 karakter).'});await sql`UPDATE personnel_desk.users SET full_name=${fullName},updated_at=now() WHERE id=${user.id}::uuid`;return json(res,200,{ok:true,full_name:fullName});
      }
      if(action==='change-password'){
        requireRole(user,'admin','hrd','manager','employee');
        const old=String(body.current_password||''),next=String(body.new_password||'');
        if(next.length<12||next.length>200)return json(res,400,{error:'Password baru minimal 12 karakter.'});
        const [record]=await sql`SELECT password_salt,password_hash FROM personnel_desk.users WHERE id=${user.id}::uuid`;
        if(!await checkPassword(old,record.password_salt,record.password_hash))return json(res,400,{error:'Password saat ini tidak sesuai.'});
        const h=await hashPassword(next);await sql`UPDATE personnel_desk.users SET password_salt=${h.salt},password_hash=${h.hash},updated_at=now() WHERE id=${user.id}::uuid`;
        return json(res,200,{ok:true,message:'Password berhasil diubah.'});
      }
      if(action==='submit-request'){
        requireRole(user,'employee');
        const [enabled]=await sql`SELECT value FROM personnel_desk.settings WHERE key='public_form_enabled'`;
        if(enabled?.value===false)return json(res,403,{error:'Pengajuan melalui QR sedang ditutup oleh Admin.'});
        if(!user.employee_nik)return json(res,400,{error:'Akun karyawan belum terhubung ke master karyawan. Hubungi Admin.'});
        const input=validateRequestInput(body);
        const [emp]=await sql`SELECT data FROM personnel_desk.employees WHERE nik=${user.employee_nik}`;
        if(!emp||emp.data.active===false)return json(res,403,{error:'Data karyawan tidak ditemukan atau sudah nonaktif.'});
        const e=emp.data;
        const [hrdCount]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=${clean(e.division)})`;
        const [managerCount]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='manager' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=${clean(e.division)})`;
        if(Number(hrdCount.n)===0)return json(res,409,{error:'Belum ada akun HRD aktif. Hubungi Admin sebelum mengajukan izin.'});
        if(Number(managerCount.n)===0)return json(res,409,{error:'Belum ada akun Manajer aktif. Hubungi Admin sebelum mengajukan izin.'});
        const [created]=await sql`
          WITH ins AS (
            INSERT INTO personnel_desk.exit_requests(employee_nik,employee_name,position,division,request_date,exit_at,return_time,reason,whatsapp,status)
            VALUES(${user.employee_nik},${clean(e.name)},${clean(e.position)},${clean(e.division)},${input.requestDate}::date,now(),${input.returnTime}::time,${input.reason},${input.whatsapp},'menunggu_hrd') RETURNING *
          ), ev AS (
            INSERT INTO personnel_desk.workflow_events(request_id,actor_user_id,actor_name,actor_role,action,from_status,to_status,note)
            SELECT id,${user.id}::uuid,${user.full_name},'employee','submit',NULL,'menunggu_hrd','Pengajuan awal melalui formulir QR' FROM ins RETURNING id
          ), employee_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT ${user.id}::uuid,id,'Pengajuan terkirim','Pengajuan izin keluar Anda berhasil dikirim dan sedang menunggu verifikasi HRD.','success' FROM ins RETURNING id
          ), recipients AS (
            SELECT u.id FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=(SELECT division FROM ins LIMIT 1))
            UNION ALL SELECT id FROM personnel_desk.users WHERE role='admin' AND is_active=true
              AND NOT EXISTS(SELECT 1 FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=(SELECT division FROM ins LIMIT 1)))
          ), hrd_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT recipients.id,ins.id,'Pengajuan baru menunggu HRD',ins.employee_name||' mengajukan izin keluar. Silakan lakukan verifikasi tahap 1.','info' FROM ins CROSS JOIN recipients RETURNING id
          ) SELECT id,employee_nik,employee_name,position,division,request_date,exit_at,return_time,reason,whatsapp,status,revision_no,created_at FROM ins`;
        return json(res,201,{request:created});
      }
      if(action==='resubmit-request'){
        requireRole(user,'employee');const [enabled]=await sql`SELECT value FROM personnel_desk.settings WHERE key='public_form_enabled'`;if(enabled?.value===false)return json(res,403,{error:'Formulir pengajuan sedang ditutup oleh Admin.'});const input=validateRequestInput(body);const [emp]=await sql`SELECT data FROM personnel_desk.employees WHERE nik=${user.employee_nik}`;if(!emp||emp.data.active===false)return json(res,400,{error:'Data karyawan tidak ditemukan atau sudah nonaktif.'});const [hrdCount]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=${clean(emp.data.division)})`;if(Number(hrdCount.n)===0)return json(res,409,{error:'Belum ada akun HRD aktif untuk divisi Anda.'});
        const [updated]=await sql`
          WITH upd AS (
            UPDATE personnel_desk.exit_requests SET employee_name=${clean(emp.data.name)},position=${clean(emp.data.position)},division=${clean(emp.data.division)},request_date=${input.requestDate}::date,exit_at=now(),return_time=${input.returnTime}::time,reason=${input.reason},whatsapp=${input.whatsapp},status='menunggu_hrd',revision_no=revision_no+1,rejection_stage=NULL,hrd_user_id=NULL,hrd_name='',hrd_reviewed_at=NULL,hrd_note='',manager_user_id=NULL,manager_name='',manager_reviewed_at=NULL,manager_note='',updated_at=now()
            WHERE id=${clean(body.id)}::uuid AND employee_nik=${user.employee_nik} AND status='ditolak' RETURNING *
          ), ev AS (
            INSERT INTO personnel_desk.workflow_events(request_id,actor_user_id,actor_name,actor_role,action,from_status,to_status,note)
            SELECT id,${user.id}::uuid,${user.full_name},'employee','resubmit','ditolak','menunggu_hrd','Karyawan memperbaiki dan mengirim ulang pengajuan' FROM upd RETURNING id
          ), employee_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT ${user.id}::uuid,id,'Pengajuan dikirim ulang','Perbaikan pengajuan berhasil dikirim dan menunggu pemeriksaan HRD.','success' FROM upd RETURNING id
          ), recipients AS (
            SELECT u.id FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=(SELECT division FROM upd LIMIT 1))
            UNION ALL SELECT id FROM personnel_desk.users WHERE role='admin' AND is_active=true AND NOT EXISTS(SELECT 1 FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='hrd' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=(SELECT division FROM upd LIMIT 1)))
          ), hrd_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT recipients.id,upd.id,'Pengajuan diperbaiki',upd.employee_name||' mengirim ulang pengajuan yang perlu diperbaiki.','info' FROM upd CROSS JOIN recipients RETURNING id
          ) SELECT * FROM upd`;
        if(!updated)return json(res,409,{error:'Pengajuan tidak ditemukan atau statusnya bukan ditolak.'});return json(res,200,{request:updated});
      }
      if(action==='review-request'){
        requireRole(user,'hrd','manager');const id=clean(body.id),decision=clean(body.decision),note=clean(body.note);if(!/^[0-9a-f-]{36}$/i.test(id))return json(res,400,{error:'ID pengajuan tidak valid.'});if(user.employee_nik){const [actorEmployee]=await sql`SELECT data FROM personnel_desk.employees WHERE nik=${user.employee_nik}`;const [targetRequest]=await sql`SELECT division FROM personnel_desk.exit_requests WHERE id=${id}::uuid`;if(!targetRequest)return json(res,404,{error:'Pengajuan tidak ditemukan.'});if(clean(actorEmployee?.data?.division)!==clean(targetRequest.division))return json(res,403,{error:'Anda hanya dapat memverifikasi pengajuan dari divisi yang ditugaskan.'});}if(!['approve','reject'].includes(decision))return json(res,400,{error:'Keputusan verifikasi tidak valid.'});if(decision==='reject'&&!note)return json(res,400,{error:'Alasan penolakan wajib diisi.'});
        if(user.role==='hrd'&&decision==='approve'){const [reqRow]=await sql`SELECT division FROM personnel_desk.exit_requests WHERE id=${id}::uuid AND status='menunggu_hrd'`;const [m]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.role='manager' AND u.is_active=true AND (u.employee_nik IS NULL OR pe.data->>'division'=${reqRow?.division||''})`;if(Number(m.n)===0)return json(res,409,{error:'Belum ada akun Manajer aktif. Hubungi Admin.'});}
        const expected=user.role==='hrd'?'menunggu_hrd':'menunggu_manager';const next=user.role==='hrd'?(decision==='approve'?'menunggu_manager':'ditolak'):(decision==='approve'?'disetujui':'ditolak');const stage=decision==='reject'?user.role:null;
        const [updated]=await sql`
          WITH upd AS (
            UPDATE personnel_desk.exit_requests SET status=${next},rejection_stage=${stage},
              hrd_user_id=CASE WHEN ${user.role}='hrd' THEN ${user.id}::uuid ELSE hrd_user_id END,
              hrd_name=CASE WHEN ${user.role}='hrd' THEN ${user.full_name} ELSE hrd_name END,
              hrd_reviewed_at=CASE WHEN ${user.role}='hrd' THEN now() ELSE hrd_reviewed_at END,
              hrd_note=CASE WHEN ${user.role}='hrd' THEN ${note} ELSE hrd_note END,
              manager_user_id=CASE WHEN ${user.role}='manager' THEN ${user.id}::uuid ELSE manager_user_id END,
              manager_name=CASE WHEN ${user.role}='manager' THEN ${user.full_name} ELSE manager_name END,
              manager_reviewed_at=CASE WHEN ${user.role}='manager' THEN now() ELSE manager_reviewed_at END,
              manager_note=CASE WHEN ${user.role}='manager' THEN ${note} ELSE manager_note END,
              updated_at=now()
            WHERE id=${id}::uuid AND status=${expected} RETURNING *
          ), ev AS (
            INSERT INTO personnel_desk.workflow_events(request_id,actor_user_id,actor_name,actor_role,action,from_status,to_status,note)
            SELECT id,${user.id}::uuid,${user.full_name},${user.role},${decision},${expected},${next},${note} FROM upd RETURNING id
          ), employee_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT u.id,upd.id,
              CASE WHEN ${next}='menunggu_manager' THEN 'Lolos verifikasi HRD' WHEN ${next}='disetujui' THEN 'Izin disetujui' ELSE 'Pengajuan perlu diperbaiki' END,
              CASE WHEN ${next}='menunggu_manager' THEN 'Pengajuan Anda lolos verifikasi HRD dan diteruskan ke Manajer.' WHEN ${next}='disetujui' THEN 'Pengajuan izin keluar Anda telah disetujui Manajer. Surat PDF sudah tersedia.' ELSE 'Pengajuan ditolak pada tahap '||${user.role}||'. Alasan: '||${note} END,
              CASE WHEN ${next}='disetujui' THEN 'success' WHEN ${next}='ditolak' THEN 'warning' ELSE 'info' END
            FROM upd JOIN personnel_desk.users u ON u.role='employee' AND u.employee_nik=upd.employee_nik AND u.is_active=true RETURNING id
          ), manager_notice AS (
            INSERT INTO personnel_desk.notifications(user_id,request_id,title,message,notification_type)
            SELECT u.id,upd.id,'Pengajuan menunggu Manajer',upd.employee_name||' lolos verifikasi HRD dan menunggu keputusan Anda.','info'
            FROM upd JOIN personnel_desk.users u ON u.role='manager' AND u.is_active=true LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE ${next}='menunggu_manager' AND (u.employee_nik IS NULL OR pe.data->>'division'=upd.division) RETURNING id
          ) SELECT * FROM upd`;
        if(!updated)return json(res,409,{error:'Pengajuan tidak ditemukan, sudah diproses, atau bukan antrean verifikasi Anda.'});return json(res,200,{request:updated});
      }
      if(action==='mark-notifications'){
        requireRole(user,'admin','hrd','manager','employee');if(body.all===true)await sql`UPDATE personnel_desk.notifications SET read_at=now() WHERE user_id=${user.id}::uuid AND read_at IS NULL`;else if(body.id)await sql`UPDATE personnel_desk.notifications SET read_at=now() WHERE id=${Number(body.id)} AND user_id=${user.id}::uuid`;return json(res,200,{ok:true});
      }
      if(action==='user-save'){
        requireRole(user,'admin');const id=clean(body.id),username=clean(body.username).toLowerCase(),fullName=clean(body.full_name),role=clean(body.role),employeeNik=clean(body.employee_nik)||null,password=String(body.password||'');if(!/^[a-z0-9._-]{3,80}$/.test(username))return json(res,400,{error:'Username 3–80 karakter: huruf kecil, angka, titik, garis bawah atau strip.'});if(!fullName||fullName.length>180||!ROLES.has(role))return json(res,400,{error:'Nama atau peran tidak valid.'});if(role==='employee'&&!employeeNik)return json(res,400,{error:'Akun Karyawan wajib dihubungkan ke master karyawan.'});if(employeeNik){const [e]=await sql`SELECT nik,data FROM personnel_desk.employees WHERE nik=${employeeNik}`;if(!e)return json(res,400,{error:'NIK karyawan tidak ditemukan di master.'});if(e.data.active===false)return json(res,400,{error:'Akun tidak dapat dihubungkan ke karyawan nonaktif.'});}
        if(!id&&!password)return json(res,400,{error:'Password awal wajib diisi untuk akun baru.'});if(password&&password.length<12)return json(res,400,{error:'Password minimal 12 karakter.'});if(id===user.id&&(!body.is_active||role!=='admin'))return json(res,400,{error:'Akun Admin yang sedang digunakan tidak boleh dinonaktifkan atau diturunkan perannya.'});if(id){const [target]=await sql`SELECT role,is_active FROM personnel_desk.users WHERE id=${id}::uuid`;if(target?.role==='admin'&&target.is_active&&(role!=='admin'||body.is_active===false)){const [activeAdmins]=await sql`SELECT count(*)::int AS n FROM personnel_desk.users WHERE role='admin' AND is_active=true AND id<>${id}::uuid`;if(Number(activeAdmins.n)===0)return json(res,400,{error:'Harus ada minimal satu akun Admin aktif.'});}}
        const h=password?await hashPassword(password):null;let row;
        if(id){[row]=await sql`UPDATE personnel_desk.users SET username=${username},full_name=${fullName},role=${role},employee_nik=${employeeNik},is_active=${body.is_active!==false},password_salt=COALESCE(${h?.salt||null},password_salt),password_hash=COALESCE(${h?.hash||null},password_hash),updated_at=now() WHERE id=${id}::uuid RETURNING id,username,full_name,role,employee_nik,is_active`;}
        else{[row]=await sql`INSERT INTO personnel_desk.users(username,full_name,role,employee_nik,password_salt,password_hash,is_active) VALUES(${username},${fullName},${role},${employeeNik},${h.salt},${h.hash},true) RETURNING id,username,full_name,role,employee_nik,is_active`;}
        if(!row)return json(res,404,{error:'Akun tidak ditemukan.'});return json(res,200,{user:row});
      }
      if(action==='employee-save'){
        requireRole(user,'admin');const e=body.employee||{};const payload={nik:clean(e.nik),name:clean(e.name),division:clean(e.division),position:clean(e.position),join:clean(e.join),phone:clean(e.phone),emergency:clean(e.emergency),active:e.active!==false};if(!payload.nik||!payload.name)return json(res,400,{error:'NIK dan nama karyawan wajib diisi.'});const [r]=await sql`SELECT personnel_desk.upsert_employee(${JSON.stringify(payload)}::jsonb) AS revision`;return json(res,200,{employee:payload,revision:r.revision});
      }
      if(action==='employee-import'){
        requireRole(user,'admin');if(!Array.isArray(body.employees)||body.employees.length<1||body.employees.length>2000)return json(res,400,{error:'Pilih 1–2.000 data karyawan yang valid.'});const batch=body.employees.map(e=>({nik:clean(e.nik),name:clean(e.name),division:clean(e.division),position:clean(e.position),join:clean(e.join),phone:clean(e.phone),emergency:clean(e.emergency),active:e.active!==false}));if(batch.some(e=>!e.nik||!e.name||e.nik.length>120||e.name.length>200))return json(res,400,{error:'Setiap baris wajib memiliki NIK dan Nama; periksa panjang data.'});const [r]=await sql`SELECT personnel_desk.upsert_employees(${JSON.stringify(batch)}::jsonb) AS revision`;return json(res,200,{count:batch.length,revision:r.revision});
      }
      if(action==='settings-save'){
        requireRole(user,'admin');const enabled=body.public_form_enabled===true;await sql`INSERT INTO personnel_desk.settings(key,value,updated_at) VALUES('public_form_enabled',${JSON.stringify(enabled)}::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;return json(res,200,{public_form_enabled:enabled});
      }
      return json(res,404,{error:'Aksi API tidak dikenal.'});
    }

    if(action==='qr'){
      const user=await sessionUser(sql,req);requireRole(user,'admin');const protocol=req.headers['x-forwarded-proto']==='http'?'http':'https';const host=req.headers['x-forwarded-host']||req.headers.host;const target=`${protocol}://${host}/?scan=1`;const svg=await QRCode.toString(target,{type:'svg',width:260,margin:2,errorCorrectionLevel:'M'});res.setHeader('Content-Type','image/svg+xml; charset=utf-8');return res.status(200).send(svg);
    }
    if(action==='me'){
      const user=await sessionUser(sql,req);if(!user)return json(res,401,{error:'Silakan masuk.'});return json(res,200,{user});
    }
    const user=await sessionUser(sql,req);requireRole(user,'admin','hrd','manager','employee');
    if(action==='requests'){
      let rows;if(user.role==='employee')rows=await sql`SELECT r.* FROM personnel_desk.exit_requests r WHERE r.employee_nik=${user.employee_nik} ORDER BY r.created_at DESC LIMIT 500`;
      else if(user.role==='hrd')rows=await sql`SELECT r.* FROM personnel_desk.exit_requests r WHERE (r.status='menunggu_hrd' AND EXISTS(SELECT 1 FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.id=${user.id}::uuid AND (u.employee_nik IS NULL OR pe.data->>'division'=r.division))) OR r.hrd_user_id=${user.id}::uuid ORDER BY r.created_at DESC LIMIT 1000`;
      else if(user.role==='manager')rows=await sql`SELECT r.* FROM personnel_desk.exit_requests r WHERE (r.status='menunggu_manager' AND EXISTS(SELECT 1 FROM personnel_desk.users u LEFT JOIN personnel_desk.employees pe ON pe.nik=u.employee_nik WHERE u.id=${user.id}::uuid AND (u.employee_nik IS NULL OR pe.data->>'division'=r.division))) OR r.manager_user_id=${user.id}::uuid ORDER BY r.created_at DESC LIMIT 1000`;
      else rows=await sql`SELECT r.* FROM personnel_desk.exit_requests r ORDER BY r.created_at DESC LIMIT 5000`;
      return json(res,200,{requests:rows});
    }
    if(action==='notifications'){
      const rows=await sql`SELECT id,request_id,title,message,notification_type,read_at,created_at FROM personnel_desk.notifications WHERE user_id=${user.id}::uuid ORDER BY created_at DESC LIMIT 100`;const [count]=await sql`SELECT count(*)::int AS unread FROM personnel_desk.notifications WHERE user_id=${user.id}::uuid AND read_at IS NULL`;return json(res,200,{notifications:rows,unread:Number(count.unread)});
    }
    if(action==='legacy-leaves'){
      requireRole(user,'admin');const rows=await sql`SELECT data FROM personnel_desk.leaves ORDER BY updated_at DESC LIMIT 5000`;return json(res,200,{leaves:rows.map(r=>r.data)});
    }
    if(action==='users'){
      requireRole(user,'admin');const rows=await sql`SELECT u.id,u.username,u.full_name,u.role,u.employee_nik,u.is_active,u.created_at,e.data->>'division' AS division FROM personnel_desk.users u LEFT JOIN personnel_desk.employees e ON e.nik=u.employee_nik ORDER BY u.role,u.full_name`;return json(res,200,{users:rows});
    }
    if(action==='employees'){
      requireRole(user,'admin');const rows=await sql`SELECT nik,data FROM personnel_desk.employees ORDER BY data->>'name'`;return json(res,200,{employees:rows.map(r=>r.data)});
    }
    if(action==='settings'){
      requireRole(user,'admin');const [r]=await sql`SELECT value FROM personnel_desk.settings WHERE key='public_form_enabled'`;return json(res,200,{public_form_enabled:r?.value!==false,public_url:`${req.headers['x-forwarded-proto']==='http'?'http':'https'}://${req.headers['x-forwarded-host']||req.headers.host}/?scan=1`});
    }
    if(action==='report'){
      requireRole(user,'admin');const from=clean(url.searchParams.get('from')),to=clean(url.searchParams.get('to')),status=clean(url.searchParams.get('status'));let rows=await sql`SELECT r.* FROM personnel_desk.exit_requests r ORDER BY r.created_at DESC LIMIT 10000`;if(from&&validDate(from))rows=rows.filter(r=>String(r.request_date).slice(0,10)>=from);if(to&&validDate(to))rows=rows.filter(r=>String(r.request_date).slice(0,10)<=to);if(status&&STATUS.has(status))rows=rows.filter(r=>r.status===status);return json(res,200,{requests:rows});
    }
    if(action==='events'){
      const id=clean(url.searchParams.get('id'));if(!/^[0-9a-f-]{36}$/i.test(id))return json(res,400,{error:'ID pengajuan tidak valid.'});const [r]=await sql`SELECT employee_nik,division FROM personnel_desk.exit_requests WHERE id=${id}::uuid`;if(!r)return json(res,404,{error:'Pengajuan tidak ditemukan.'});if(user.role==='employee'&&r.employee_nik!==user.employee_nik)return json(res,403,{error:'Tidak diizinkan.'});if((user.role==='hrd'||user.role==='manager')&&user.employee_nik){const [actorEmployee]=await sql`SELECT data FROM personnel_desk.employees WHERE nik=${user.employee_nik}`;if(clean(actorEmployee?.data?.division)!==clean(r.division))return json(res,403,{error:'Tidak diizinkan untuk divisi ini.'});}const rows=await sql`SELECT actor_name,actor_role,action,from_status,to_status,note,created_at FROM personnel_desk.workflow_events WHERE request_id=${id}::uuid ORDER BY created_at ASC`;return json(res,200,{events:rows});
    }
    return json(res,404,{error:'Aksi API tidak dikenal.'});
  }catch(e){const status=e.status||500;if(status>=500)console.error('Personnel Desk V3 API:',e.code||e.name||e.message);return json(res,status,{error:status===500?'Terjadi kesalahan server. Periksa konfigurasi dan schema Neon.':e.message});}
}
