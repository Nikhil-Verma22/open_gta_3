// Local offline guard implementation for reGTA3 WASM

const CAPTURED_FRAMES_HEX = [
  "000000000000000037f98a00000000003309a6691984c541a3ab858b908c21bdf003061846b42dfef21d95ea86e3da9637e1ded084c1d2dabf0af4d4c0b6b0c69f3e2c141d3f05a28b75286c3f605104",
  "0100000000000000bec8dc00000000006393e417362abda9a5cee4cc7805ea230cdd90e90bddd23cbfd070945fd1a7957918128fbc32ccdfed55cafee0a069134b0ddf2508ae1f61d26db0a1a923e909",
  "020000000000000047ca57010000000050e35a8e66c16d34c614ece399ebd7ed516333bbc2578cbe0f5319016758e3d6db7246ae2f55e3c36e7f6c75c42ffc864860d6807a23aa0266e18a5109912903",
  "0300000000000000463cc40100000000e5112e088977a406b50b27267b92948ea407b67f111b5fc19810cf5a76b36caf73d51995441213dcaea6546c439aa7c276a6abe1c62490900d1a3a8e053a640d",
  "040000000000000060dd420200000000a12885db303754449698c20b09c4348c1e98a08b8a1c24dd7914429ab59161ce832d722474a4fd71aec697f53e783f49b3b015de8eacbeccc488d71173825b07",
  "0500000000000000e5b6cd0200000000dc4d3bee7ec722dade20bb566e03175fd29b0e3db30edcf995f1a06b5fdb29a0d4027837fea722210eefc11b00a208872534ead4a3a6d8e908bd270d1062460a",
  "0600000000000000eb284d0300000000ce79e30ee88fb3e2c80e128e55f74154fecd26df28e63f737dc6f8b71366664377e5754f57984082b738944b01792ed9c649f3f0fa8362796b899d9f6637df06",
  "07000000000000003c06c00300000000a873c722252d357091fe96f17eb4f653ed2a1864455a1baa1aa5a6b9a9532862e46dd0a842928a9135da113b8cd671fce75476cd9da9c98acb3f8fa91d8a2f0d",
  "0800000000000000b2cb4d0400000000721a5169380e7a854956b2d9b262447863744a7ff9d8e251d3e68a4ae45727d4e728f54dee4b407ddb3b7a806be99afc90adde2ea5cd095fb9f9620c90d7cc06",
  "09000000000000007488e50400000000c3e353e2f2f2287bae113ac6c30b1090fba48298844308839fc583129324900150def199044f0fb3aa2c67da8dccee996eb20f4602c82129c9d5d1cdcc139b08",
  "0a00000000000000b82b360500000000547fe6c20c1878d45a5fe88b1b164b65abfdc2f7a5bec2dca3049da28251877cc78e2d10c600d269361fa9e826f1a374811139236231447d9ee11cd446a9700f",
  "0b0000000000000076a0cd050000000058bd5e873c814aeee3c68f94681c0e75a6189eb8311371826a008caadf3ec0a26a7821007e1ccb211628959fcfc40bb437b5bb48ba818df2f013aa0daa232c03",
  "0c00000000000000a07b53060000000070ce27361d53afb6f4d86d2311110c87f8c7d551417abdcd08b5800528e4ee92405876dcab097b827a8ef25db700be64441e5f2c23dd323454e5170d44999b02",
  "0d000000000000002e24e50600000000d7a727067c59ac8627dbc2d2fd1c73e8a53f2b267b5f59b75b125d3a6206fd4264476f47e9362c62108e435475953722ca93fcbc9310b38488557163e1e74c04",
  "0e000000000000009c173307000000000b739da3c2c09ef7d7d8b3ccf1849df7f6e64e69ade082bac3143d4e812a2709c677f3c0fc88515ed16fcc3ef1c93294e5bfd310601b9f9e053200454700fe05",
  "0f0000000000000002f8c50700000000d05acacad429e3ba59aa5eae51faadbf90d42d607b5322e2c31e324c03dd7424a1396075b85337dc44d57243c66b9cb770d87a4128ffafae4a11e3ed3b97af0a",
  "1000000000000000b9d75308000000001bf48b4a1e2425be1594edcdb6267f286478a49d07f3953129f1a3029ff4f17eb31662be4cf7b6ff868b486f1481d34143061ce82fee64867c88ebfdc377010f",
  "11000000000000005afed308000000000a3f0718eb6e6189b6f114ffff3490cfa68a04b9cf209c959a263ec6d06bb6c1a7f8dc77c97ae7a816bcb1e01d13f5bb49fd602c0392541b34248e84b970cd00",
  "12000000000000003324220900000000f983b7d45f74710c1346f832fa3f5a2f5c42fc2a660119d9ae2660a09f9559ea2c57ee65ac79c9a28f5db843327f35b5766a3481c49d46e16a129ef1a9b9cf08",
  "13000000000000006a3b710900000000f41f44f46c34601007d059de011182bde804c3cf6b84d862462440770888aba12f56dc1029bebb51f31fc5e05e4b7e4bf7f9e98818afe333a833098885e18a0a",
  "140000000000000096d2be090000000038220b363ed41f27aa45b220f2844cb4510fb40b5dbe198a100381a1db1d397ec1a2e8eb23b71c5b0e70e1dc4bd7ae39648d611eaa2083ab9b2d8adc4d242504",
  "15000000000000000996180a00000000d95795d63272870175ddf114a8bfa4bdfd954978460f4ae208c1b31f131f59a28c2778cc2fa5b3260fc31f61bfd639c074f6863ea00cc796bad4e2388cb0f908",
  "16000000000000003405850a00000000371fe7e11db8efb17686e3933a2cb12751d0aeec3d1328b7e2333dc4a779744a57cafcbfedc9428b2094bb20688f93e9bd2c8e5cfd009b6cf8a8c49069ce270d",
  "17000000000000008b6f110b0000000092573a3414cad3d35322de53f8e25f966f343dacba310c90adcac1d2c68b2ab1c3718007133e27dd87de3f2d4d379e9b097b41fa846fa66f03f7d24d59f0a60d",
  "1800000000000000339f780b00000000d8cf9f6b91eff0104473029c25c97ecf04d7398352924852fb6a6a0c441680b1ea9b3af1fc4e3d5d8e230e5b0e6960a0c662cf6ab2062923488256bf878e5508",
  "190000000000000040820b0c00000000874f2784e990bc05755c358db8a5f8f8938ba390b88b2f3f949fa8d9f69e174911386253ea5458125cb89455ff157bb39be9ed2e8bc51dee275fad930d6aa10c",
  "1a00000000000000bf87960c0000000025c1a01123e05b923d26ef3564a2f51fbd67ae7f5f42a029ab174a6ce3ec9cdb4e6901742dd1716b42698b7425c9f25142b9b35e8e0fe9a3310c776a9284af0e",
  "1b00000000000000a8022e0d0000000029bdbefcf7aa77a3e64bfddcc65df5df7adab12d27c33ee124597602c2da1724481b187700b9a421ca6727c0f5ac54ad1eddfc40050ea83a7bee1f62b45cf607",
  "1c00000000000000767a960d000000000ba52f8df4a0d485b99c59007fcbd15a7b425b9657fafe3943dd93a168e47c4335ef0feb5274c0d163c71d38ff179331aa03009164a00202b5c97acd8bff4708",
  "1d000000000000002ebfea0d00000000b3174d28451580b5005b44e5ebb8ce07185cbe3ee2f34ce64a4ffb6bc7f034e4aae48138e285675043531168032f2368c2b088d940ba5392d2e3472ebdac0507",
  "1e00000000000000dd09510e00000000e7fc4a30ba90b24001f3ddeba7f3923b8e7632f4fe7650533436023913a96a4dbf61077c4d2aa96fe0941891bc682cfb77c4866f7eb2f1ed6933b92fa5dea70a",
  "1f0000000000000053c7b40e000000001c892d59c3951f19a398c234621a8c391cc66a061aab091010e56c68ddec11041b6e7c568cae392f2c43b2a0f051ea259df98e110c0c9368b274995896e3c403"
];

const CAPTURED_FRAMES = CAPTURED_FRAMES_HEX.map(hex => {
  const bytes = new Uint8Array(80);
  for (let i = 0; i < 80; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
});

export const GUARD_REGION_BASE = 34406400;
export const GUARD_REGION_SIZE = 2097152;

function exportFunction(exports, ...names) {
  for (const name of names) {
    if (typeof exports?.[name] === 'function') return exports[name];
  }
  return null;
}

export function reserveGuardRegion(instance, { base = GUARD_REGION_BASE, size = GUARD_REGION_SIZE } = {}) {
  const exports = instance?.exports;
  if (!exports) return;
  const target = base + size;
  const sbrk = exportFunction(exports, "sbrk", "_sbrk", "rg");
  if (sbrk) {
    try {
      const cur = Number(sbrk(0));
      if (cur < target) {
        sbrk(target - cur);
      }
    } catch (err) {
      console.warn('[regta3] sbrk failed:', err);
    }
  } else if (exports.memory && exports.memory.buffer) {
    try {
      const curBytes = exports.memory.buffer.byteLength;
      if (curBytes < target) {
        const needPages = Math.ceil((target - curBytes) / 65536);
        exports.memory.grow(needPages);
      }
    } catch (err) {
      console.warn('[regta3] memory.grow failed:', err);
    }
  }
}

let frameIndex = 0;
let heartbeatInterval = null;

export function initGuardLocal(instance) {
  if (!instance || !instance.exports) return;
  reserveGuardRegion(instance);
  const exports = instance.exports;
  if (typeof exports.__guard_input_ptr === 'function' && typeof exports.guard_init === 'function') {
    const ptr = exports.__guard_input_ptr();
    if (ptr > 0 && CAPTURED_FRAMES.length > 0) {
      // Frame 0 for guard_init
      const frame0 = CAPTURED_FRAMES[0];
      new Uint8Array(exports.memory.buffer, ptr, 80).set(frame0);
      exports.guard_init(80);
      frameIndex = 1;

      // Start periodic guard_on_message heartbeat
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        try {
          if (typeof exports.guard_on_message === 'function') {
            const p = exports.__guard_input_ptr();
            const f = CAPTURED_FRAMES[frameIndex % CAPTURED_FRAMES.length];
            new Uint8Array(exports.memory.buffer, p, 80).set(f);
            exports.guard_on_message(80);
            frameIndex++;
          }
        } catch (_) {}
      }, 5000);
    }
  }
}

export function agti(instance, wsUrl, callback) {
  try {
    initGuardLocal(instance);
  } catch (err) {
    console.warn('[regta3] local guard init warning:', err);
  }
  if (typeof callback === 'function') {
    callback();
  }
}
