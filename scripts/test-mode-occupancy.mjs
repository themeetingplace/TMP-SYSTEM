import assert from 'node:assert/strict';
import { calculateOccupancySnapshot, listOccupiedContracts } from '../js/utils/occupancySnapshot.js';

const data = {
    buildings: [
        { id: 'B001', mode: 'cohousing' },
        { id: 'M001', mode: 'managed' },
        { id: 'M002', mode: 'managed' }
    ],
    properties: [
        { buildingId: 'B001', name: '共居 A' },
        { buildingId: 'M001', name: '代管 A' },
        { buildingId: 'M002', name: '代管 B' }
    ],
    contracts: [
        { id: 'C1', buildingId: 'B001', propertyName: '共居 A', contractType: 'cohousing', startDate: '2026-01-01', endDate: '2027-01-01' },
        { id: 'C2', buildingId: 'M001', propertyName: '代管 A', contractType: 'managed-tenant', startDate: '2026-01-01', endDate: '2027-01-01' },
        { id: 'C3', buildingId: 'M002', propertyName: '代管 B', contractType: 'managed-tenant', startDate: '2026-01-01', endDate: '2027-01-01' },
        { id: 'C4', buildingId: 'M001', propertyName: '代管 A', contractType: 'managed-owner', startDate: '2026-01-01', endDate: '2027-01-01' }
    ]
};

assert.deepEqual(calculateOccupancySnapshot(data, '2026-09-15', null, 'cohousing'), {
    occupied: 1, total: 1, rate: 1
});
assert.deepEqual(calculateOccupancySnapshot(data, '2026-09-15', null, 'managed'), {
    occupied: 2, total: 2, rate: 1
});
assert.deepEqual(calculateOccupancySnapshot(data, '2026-09-15', 'M001', 'managed'), {
    occupied: 1, total: 1, rate: 1
});
assert.deepEqual(calculateOccupancySnapshot(data, '2026-09-15', 'B001', 'managed'), {
    occupied: 0, total: 0, rate: 0
});
assert.deepEqual(listOccupiedContracts(data, '2026-09-15', null, 'managed').map(c => c.id).sort(), ['C2', 'C3']);

console.log('mode occupancy isolation checks passed');
