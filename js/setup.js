// Supabase Setup Guide
// Run this in browser console to test Supabase connection

import { supabase } from './supabase.js';

export async function testSupabaseConnection() {
    try {
        console.log('🔍 Testing Supabase connection...');

        // Test connection by trying to get a simple query
        const { data, error } = await supabase.from('properties').select('count').limit(1);

        if (error) {
            console.error('❌ Supabase connection failed:', error);
            console.log('💡 Make sure to:');
            console.log('   1. Check your Supabase URL and API key');
            console.log('   2. Enable Row Level Security policies in Supabase');
            console.log('   3. Run the SQL scripts from README.md to create tables');
            return false;
        }

        console.log('✅ Supabase connection successful!');
        console.log('📊 Connected to database');

        // Try to get actual data
        const { data: properties, error: propError } = await supabase.from('properties').select('*').limit(5);
        if (propError) {
            console.log('⚠️ Tables may not be created yet. Run the SQL scripts from README.md');
        } else {
            console.log(`📋 Found ${properties.length} properties in database`);
        }

        return true;
    } catch (err) {
        console.error('❌ Connection test failed:', err);
        return false;
    }
}

export async function initializeMockData() {
    console.log('📝 This function is for development - mock data is handled in data.js');

    // Test if we can insert data (this will fail if tables don't exist)
    try {
        const testProperty = {
            id: 'TEST001',
            name: 'Test Property',
            address: 'Test Address',
            type: 'Test Type',
            status: 'Test Status',
            rent: 1000
        };

        const { data, error } = await supabase
            .from('properties')
            .insert(testProperty);

        if (error) {
            console.error('❌ Failed to insert test data:', error);
            console.log('💡 Make sure tables are created and RLS policies are set up');
        } else {
            console.log('✅ Successfully inserted test data');
        }
    } catch (err) {
        console.error('❌ Test insert failed:', err);
    }
}

// Make functions available globally for console testing
window.testSupabaseConnection = testSupabaseConnection;
window.initializeMockData = initializeMockData;

// Also expose a simple test function that doesn't require imports
window.quickTest = async () => {
    console.log('🔍 Quick Supabase connection test...');
    try {
        const response = await fetch('https://zkwkycpfcyecebstmotc.supabase.co/rest/v1/properties?select=count', {
            headers: {
                'apikey': 'sb_publishable_qsFrMoFYyM5DMcSt9nvNcg_pah5nruy',
                'Authorization': 'Bearer sb_publishable_qsFrMoFYyM5DMcSt9nvNcg_pah5nruy'
            }
        });
        if (response.ok) {
            console.log('✅ Supabase connection successful!');
            const data = await response.json();
            console.log('📊 Response:', data);
        } else {
            console.error('❌ Connection failed:', response.status, response.statusText);
        }
    } catch (err) {
        console.error('❌ Test failed:', err);
    }
};

// Auto-run connection test on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 BMS Application Loaded');
    console.log('💡 Run testSupabaseConnection() in console to test database connection');
    console.log('💡 Or run quickTest() for a simple connection test');
    console.log('💡 Run initializeMockData() to test data insertion');
});