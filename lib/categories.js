export const CATEGORIES = ['Cuti', 'Sakit', 'Izin', 'Izin Pulang Cepat'];

// Jenis template Excel per kategori: Cuti -> Sheet 1 (FM-020), Izin Pulang Cepat -> Sheet 2 (FM-017), lainnya -> Sheet 3 (FM-030)
export const tplOf = c => (c === 'Cuti' ? 'leave' : c === 'Izin Pulang Cepat' ? 'exit' : 'absence');
// Kotak tanda tangan per template
export const SLOTS_BY_TPL = { leave: ['hrd', 'manager', 'supervisor', 'replacement', 'employee'], absence: ['hrd', 'manager', 'supervisor', 'replacement', 'employee'], exit: ['security', 'hrd', 'leader', 'employee'] };
