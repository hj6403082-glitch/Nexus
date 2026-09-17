import { NextResponse } from 'next/server';
import { projects } from '@/server/data/adapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await projects());
}
