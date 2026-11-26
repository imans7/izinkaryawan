// Surat Izin IPK V3 retires the V2 shared-password snapshot API.
// Existing employees and legacy leave rows remain in Neon and are read by api/portal.js.
export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  return res.status(410).json({error:'API database versi lama sudah dinonaktifkan. Gunakan login Surat Izin IPK V3 dengan akun masing-masing.'});
}
