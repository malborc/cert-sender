'use strict';

const fetch = require('node-fetch');

const API_BASE   = 'https://api.cloudflare.com/client/v4';
const CF_SERVICE = 'http://traefik:80';

function creds() {
  const token   = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const tunnel  = process.env.CLOUDFLARE_TUNNEL_ID;
  const zone    = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !account || !tunnel || !zone) {
    throw new Error('Faltan variables: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_TUNNEL_ID, CLOUDFLARE_ZONE_ID');
  }
  return { token, account, tunnel, zone };
}

function hdrs(token) {
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── DNS helpers ────────────────────────────────────────────────────────────────

async function addDnsRecord(hostname) {
  const { token, tunnel, zone } = creds();

  // Idempotent: skip if already exists
  const check = await fetch(
    `${API_BASE}/zones/${zone}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`,
    { headers: hdrs(token) }
  ).then(r => r.json());
  if (check.result?.length > 0) return;

  const res  = await fetch(`${API_BASE}/zones/${zone}/dns_records`, {
    method:  'POST',
    headers: hdrs(token),
    body:    JSON.stringify({
      type:    'CNAME',
      name:    hostname,
      content: `${tunnel}.cfargotunnel.com`,
      ttl:     1,
      proxied: true,   // Cloudflare handles SSL automatically for *.manuelalbor.com
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Error creando DNS record');
}

async function removeDnsRecord(hostname) {
  const { token, zone } = creds();

  const check = await fetch(
    `${API_BASE}/zones/${zone}/dns_records?name=${encodeURIComponent(hostname)}&type=CNAME`,
    { headers: hdrs(token) }
  ).then(r => r.json());
  if (!check.result?.length) return;

  const res  = await fetch(`${API_BASE}/zones/${zone}/dns_records/${check.result[0].id}`, {
    method:  'DELETE',
    headers: hdrs(token),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Error eliminando DNS record');
}

// ── Tunnel ingress helpers ─────────────────────────────────────────────────────

async function getIngress() {
  const { token, account, tunnel } = creds();
  const res  = await fetch(`${API_BASE}/accounts/${account}/cfd_tunnel/${tunnel}/configurations`,
    { headers: hdrs(token) });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Error obteniendo tunnel config');
  return data.result?.config?.ingress || [];
}

async function putIngress(ingress) {
  const { token, account, tunnel } = creds();
  const res  = await fetch(`${API_BASE}/accounts/${account}/cfd_tunnel/${tunnel}/configurations`, {
    method:  'PUT',
    headers: hdrs(token),
    body:    JSON.stringify({ config: { ingress } }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Error actualizando tunnel');
}

async function addTunnelIngress(hostname) {
  const current  = await getIngress();
  const filtered = current.filter(r => r.hostname !== hostname && r.service !== 'http_status:404');
  await putIngress([
    ...filtered,
    { hostname, service: CF_SERVICE, originRequest: {} },
    { service: 'http_status:404' },
  ]);
}

async function removeTunnelIngress(hostname) {
  const current  = await getIngress();
  const filtered = current.filter(r => r.hostname !== hostname && r.service !== 'http_status:404');
  await putIngress([...filtered, { service: 'http_status:404' }]);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register a subdomain for a campaign's verify URL.
 * Creates a proxied CNAME DNS record and adds the hostname to the tunnel ingress.
 * Hostname must be a first-level subdomain of the Cloudflare-managed zone
 * (e.g. svcardiologia-certs.manuelalbor.com) so Universal SSL covers it.
 */
async function addSubdomain(hostname) {
  await addDnsRecord(hostname);
  await addTunnelIngress(hostname);
}

/**
 * Deregister a campaign's verify subdomain.
 * Removes the tunnel ingress entry and the DNS record.
 */
async function removeSubdomain(hostname) {
  await removeTunnelIngress(hostname);
  await removeDnsRecord(hostname);
}

module.exports = { addSubdomain, removeSubdomain };
