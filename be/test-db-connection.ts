#!/usr/bin/env ts-node
/**
 * Database Connection Test Script
 *
 * This script helps diagnose database connection issues with Supabase.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." ts-node test-db-connection.ts
 *   or
 *   ts-node test-db-connection.ts (will use DATABASE_URL from environment)
 */

import { PrismaClient } from '@prisma/client';
import * as dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

async function testConnection() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set!');
    console.error('\nPlease set it using:');
    console.error(
      '  export DATABASE_URL="postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres"',
    );
    process.exit(1);
  }

  // Mask password in URL for display
  const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@');
  console.log(`🔍 Testing connection to: ${maskedUrl}`);

  // Extract hostname from URL
  let hostname: string;
  try {
    const url = new URL(databaseUrl);
    hostname = url.hostname;
    console.log(`\n🌐 Testing DNS resolution for: ${hostname}`);

    // Test DNS resolution
    try {
      const addresses = await dnsLookup(hostname);
      console.log(
        `✅ DNS resolution successful: ${hostname} → ${addresses.address}`,
      );
    } catch (dnsError: any) {
      console.error(`\n❌ DNS resolution failed!`);
      console.error(`   Error: ${dnsError.message}`);
      console.error(`\n💡 Esto generalmente significa:`);
      console.error(`   1. El proyecto de Supabase no existe o fue eliminado`);
      console.error(
        `   2. El hostname es incorrecto (verifica el ID de referencia del proyecto)`,
      );
      console.error(
        `   3. El proyecto está pausado y el DNS no está disponible`,
      );
      console.error(
        `   4. El proyecto está siendo creado/reactivado (puede tardar varios minutos)`,
      );
      console.error(`\n⏱️  Tiempos típicos de Supabase:`);
      console.error(`   • Creación de proyecto nuevo: ~2-3 minutos`);
      console.error(`   • Reactivación de proyecto pausado: 2-5 minutos`);
      console.error(
        `   • Propagación de DNS: hasta 5 minutos después de reactivar`,
      );
      console.error(`\n🔧 Cómo solucionarlo:`);
      console.error(`   1. Ve a https://supabase.com/dashboard`);
      console.error(`   2. Verifica el estado de tu proyecto:`);
      console.error(`      → ¿Aparece en la lista?`);
      console.error(`      → ¿Está "Active" o "Paused"?`);
      console.error(`      → Si está "Paused", haz click para reactivarlo`);
      console.error(`   3. Si acabas de crear/reactivar el proyecto:`);
      console.error(`      → Espera 3-5 minutos`);
      console.error(`      → Refresca la página del dashboard`);
      console.error(`      → Verifica que el estado sea "Active"`);
      console.error(`   4. Obtén la connection string correcta:`);
      console.error(`      → Settings → Database → Connection string`);
      console.error(
        `      → Selecciona "URI" (NO "Session mode" ni "Transaction mode")`,
      );
      console.error(`      → Copia la URL EXACTA (no modifiques el hostname)`);
      console.error(`   5. Verifica el formato del hostname:`);
      console.error(`      → Formato esperado: db.[PROJECT_REF].supabase.co`);
      console.error(`      → Tu hostname actual: ${hostname}`);
      console.error(`\n🧪 Prueba manual de DNS:`);
      console.error(`   Ejecuta: nslookup ${hostname}`);
      console.error(`   O: dig ${hostname}`);
      console.error(
        `   Si estos comandos fallan, el hostname definitivamente es incorrecto`,
      );
      console.error(`\n💡 Si el proyecto está siendo creado/reactivado:`);
      console.error(
        `   Espera unos minutos y vuelve a intentar. El DNS puede tardar en propagarse.`,
      );
      process.exit(1);
    }
  } catch (urlError) {
    console.error(`\n❌ Invalid DATABASE_URL format!`);
    console.error(`   Error: ${urlError}`);
    console.error(
      `\n   Expected format: postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres`,
    );
    process.exit(1);
  }

  // Set DATABASE_URL in environment for Prisma to read
  process.env.DATABASE_URL = databaseUrl;

  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });

  try {
    console.log('\n📡 Attempting to connect...');
    await prisma.$connect();
    console.log('✅ Successfully connected to database!');

    // Test database access by trying to query a table
    console.log('\n🧪 Testing database access...');
    try {
      const count = await prisma.activity.count();
      console.log(`✅ Can access 'activity' table (${count} records)`);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        console.log(
          '⚠️  Tables not yet created. Run migrations: npx prisma migrate deploy',
        );
        console.log('✅ Connection verified (schema not yet initialized)');
      } else {
        throw error;
      }
    }

    console.log(
      '\n✅ All tests passed! Database connection is working correctly.',
    );
  } catch (error: any) {
    console.error('\n❌ Connection failed!');
    console.error('\nError details:');
    console.error('  Code:', error.code || 'N/A');
    console.error('  Message:', error.message || 'Unknown error');

    // Log full error for debugging
    if (process.env.DEBUG) {
      console.error('\nFull error object:', JSON.stringify(error, null, 2));
    }

    // Check if error message contains connection-related keywords
    const errorMessage = (error.message || '').toLowerCase();
    const isDnsError =
      error.code === 'ENOTFOUND' ||
      errorMessage.includes('could not translate host name') ||
      errorMessage.includes('nodename nor servname') ||
      errorMessage.includes('dns') ||
      errorMessage.includes('hostname');
    const isConnectionError =
      error.code === 'P1001' ||
      errorMessage.includes("can't reach") ||
      errorMessage.includes('connection') ||
      errorMessage.includes('timeout') ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      isDnsError;

    // Provide helpful suggestions based on error
    if (isDnsError) {
      console.error('\n💡 Error de Resolución DNS - Solución:');
      console.error(
        '\n  1. Verifica que tu proyecto de Supabase existe y está activo:',
      );
      console.error('     → Ve a https://supabase.com/dashboard');
      console.error('     → Verifica que tu proyecto aparezca en la lista');
      console.error(
        '     → Si está pausado, reactívalo y espera 3-5 minutos para que el DNS se actualice',
      );
      console.error(
        '     → Si fue eliminado, necesitas crear un nuevo proyecto',
      );
      console.error('\n⏱️  Tiempos de espera típicos:');
      console.error('     • Proyecto nuevo: 2-3 minutos para estar listo');
      console.error('     • Proyecto reactivado: 3-5 minutos para DNS');
      console.error(
        '     • Si acabas de crear/reactivar, espera y vuelve a intentar',
      );

      console.error('\n  2. Verifica que el hostname sea correcto:');
      try {
        const url = new URL(databaseUrl);
        console.error(`     → Tu hostname actual: ${url.hostname}`);
        console.error('     → Formato esperado: db.[PROJECT_REF].supabase.co');
        console.error(
          '     → El PROJECT_REF es un ID único de tu proyecto Supabase',
        );
      } catch {
        // URL parsing failed, already handled above
      }

      console.error('\n  3. Obtén la connection string correcta de Supabase:');
      console.error('     → Settings → Database → Connection string');
      console.error(
        '     → Selecciona "URI" (no Session mode ni Transaction mode)',
      );
      console.error(
        '     → Copia la URL EXACTA proporcionada (no modifiques el hostname)',
      );

      console.error('\n  4. Prueba la resolución DNS manualmente:');
      try {
        const url = new URL(databaseUrl);
        console.error(`     → Run: nslookup ${url.hostname}`);
        console.error(`     → Or: dig ${url.hostname}`);
        console.error('     → If these fail, the hostname is definitely wrong');
      } catch {
        // URL parsing failed
      }
    } else if (isConnectionError) {
      console.error('\n💡 Troubleshooting suggestions for connection issues:');
      console.error(
        '\n  1. Check if your Supabase project is active (not paused)',
      );
      console.error('     → Go to https://supabase.com/dashboard');
      console.error('     → Free projects pause after 1 week of inactivity');
      console.error('     → Click to reactivate and wait 1-2 minutes');

      console.error(
        '\n  2. Try using the connection pooler (port 6543) instead of direct connection:',
      );
      const poolerUrl =
        databaseUrl.replace(':5432/', ':6543/') + '?pgbouncer=true';
      console.error('     Current URL (direct):', maskedUrl);
      console.error(
        '     Try pooler URL:',
        poolerUrl.replace(/:([^:@]+)@/, ':***@'),
      );
      console.error(
        "     → Connection pooler is more reliable and doesn't require IP whitelisting",
      );

      console.error('\n  3. Verify the DATABASE_URL format:');
      console.error(
        '     → postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres',
      );
      console.error(
        '     → Make sure password is URL-encoded if it has special characters',
      );

      console.error('\n  4. Test connection manually with psql:');
      console.error('     → psql "' + databaseUrl + '"');
      console.error(
        "     → If psql works but Prisma doesn't, it might be a Prisma configuration issue",
      );

      console.error('\n  5. Check network/firewall:');
      console.error('     → Verify your internet connection');
      console.error(
        '     → Check if corporate firewall is blocking port 5432 or 6543',
      );
      console.error(
        '     → Try from a different network (e.g., mobile hotspot)',
      );

      console.error('\n  6. Get connection string from Supabase Dashboard:');
      console.error('     → Settings → Database → Connection string');
      console.error(
        '     → Select "URI" (not Session mode or Transaction mode)',
      );
      console.error('     → Copy the exact URL provided');
    } else if (error.code === 'P1000') {
      console.error('\n💡 Authentication failed!');
      console.error('  1. Check your database password');
      console.error(
        '  2. Reset password in Supabase Dashboard → Settings → Database',
      );
      console.error(
        '  3. URL-encode special characters in password (e.g., @ → %40)',
      );
      console.error(
        "  4. Make sure you're using the correct password (not API keys)",
      );
    } else {
      console.error('\n💡 General troubleshooting:');
      console.error('  1. Check Supabase Dashboard for project status');
      console.error('  2. Verify DATABASE_URL is correctly formatted');
      console.error('  3. Try the connection pooler URL (port 6543)');
      console.error(
        '  4. Check Supabase status page: https://status.supabase.com/',
      );
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
    console.log('\n👋 Disconnected from database.');
  }
}

testConnection().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
