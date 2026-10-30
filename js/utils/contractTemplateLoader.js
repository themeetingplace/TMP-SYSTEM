import { mockData } from '../data.js';
import { supabase } from '../supabase.js';

const loadingByBuilding = new Map();

/**
 * 合約 PDF 不再跟著全系統同步。只有真的要產生、檢查或測試該館合約時，
 * 才下載單一館別的 pdf_base64，並只快取在本次分頁的記憶體中。
 */
export async function ensureContractTemplatePdf(buildingId) {
    if (!buildingId) throw new Error('缺少館別，無法載入合約樣板');
    if (!Array.isArray(mockData.contractTemplates)) mockData.contractTemplates = [];

    let template = mockData.contractTemplates.find(t => t.buildingId === buildingId);
    if (template?.pdfBase64 && template.pdfBase64.length >= 200) return template;
    if (loadingByBuilding.has(buildingId)) return loadingByBuilding.get(buildingId);

    const request = (async () => {
        const { data, error } = await supabase
            .from('contract_templates')
            .select('building_id,file_name,pdf_base64,uploaded_at,updated_at')
            .eq('building_id', buildingId)
            .maybeSingle();
        if (error) throw new Error(`載入合約樣板失敗：${error.message}`);
        if (!data) throw new Error('此館尚未上傳合約樣板');
        if (!data.pdf_base64 || data.pdf_base64.length < 200) {
            throw new Error('合約樣板內容缺失，請至系統設定重新上傳');
        }

        template = mockData.contractTemplates.find(t => t.buildingId === buildingId);
        const loaded = {
            buildingId: data.building_id,
            fileName: data.file_name,
            pdfBase64: data.pdf_base64,
            pdfLoaded: true,
            uploadedAt: data.uploaded_at,
            updatedAt: data.updated_at
        };
        if (template) Object.assign(template, loaded);
        else mockData.contractTemplates.push(loaded);
        return template || loaded;
    })().finally(() => loadingByBuilding.delete(buildingId));

    loadingByBuilding.set(buildingId, request);
    return request;
}
