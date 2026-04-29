import type { Doctor } from "@/store/wizard";

type NPIResult = {
  number: string;
  basic?: {
    first_name?: string;
    last_name?: string;
    organization_name?: string;
    credential?: string;
  };
  addresses?: { city?: string; state?: string }[];
  taxonomies?: { primary?: boolean; desc?: string }[];
};

const DOCTOR_CREDENTIALS = [
  "MD",
  "DO",
  "DDS",
  "DMD",
  "DPM",
  "OD",
  "PharmD",
  "NP",
  "PA",
  "APRN",
];

async function call(
  type: 1 | 2,
  params: Record<string, string>,
): Promise<NPIResult[]> {
  try {
    const search = new URLSearchParams({
      version: "2.1",
      limit: "8",
      enumeration_type: type === 1 ? "NPI-1" : "NPI-2",
      ...params,
    });
    const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?${search}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

function mapResult(r: NPIResult, type: 1 | 2): Doctor {
  if (type === 2) {
    const addr = r.addresses?.[0];
    return {
      id: `npi_${r.number}`,
      n: r.basic?.organization_name ?? "Unknown Org",
      s:
        r.taxonomies?.find((t) => t.primary)?.desc ?? "Healthcare Organization",
      net: addr ? [addr.city, addr.state].filter(Boolean).join(", ") : "",
      npi: r.number,
    };
  }
  const b = r.basic ?? {};
  const addr = r.addresses?.[0];
  const tax = r.taxonomies?.find((t) => t.primary);
  const cred = (b.credential ?? "").replace(/,/g, "").trim();
  const isDr = DOCTOR_CREDENTIALS.some((c) => cred.includes(c));
  const nameParts = [
    isDr ? "Dr." : "",
    b.first_name ?? "",
    b.last_name ?? "",
    cred ? `, ${cred}` : "",
  ];
  const nm = nameParts.filter(Boolean).join(" ").replace(" ,", ",").trim();
  return {
    id: `npi_${r.number}`,
    n: nm || "Unknown Provider",
    s: tax?.desc ?? "Healthcare Provider",
    net: addr ? [addr.city, addr.state].filter(Boolean).join(", ") : "",
    npi: r.number,
  };
}

export async function searchDoctors(
  query: string,
  used: string[],
): Promise<Doctor[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const requests: Promise<NPIResult[]>[] = [];

  if (words.length >= 2) {
    requests.push(
      call(1, { first_name: words[0], last_name: words.slice(1).join(" ") }),
    );
    requests.push(
      call(1, { last_name: words[0], first_name: words.slice(1).join(" ") }),
    );
  } else {
    requests.push(call(1, { last_name: q }));
    requests.push(call(1, { first_name: q }));
  }
  requests.push(call(2, { organization_name: q }));

  const all = await Promise.allSettled(requests);
  const seen = new Set<string>();
  const out: Doctor[] = [];
  let idx = 0;
  for (const r of all) {
    const type = idx === 2 ? (2 as const) : (1 as const);
    idx++;
    if (r.status !== "fulfilled" || !r.value.length) continue;
    for (const item of r.value) {
      const mapped = mapResult(item, type);
      if (seen.has(mapped.id) || used.includes(mapped.id)) continue;
      seen.add(mapped.id);
      out.push(mapped);
      if (out.length >= 9) break;
    }
    if (out.length >= 9) break;
  }
  return out;
}
