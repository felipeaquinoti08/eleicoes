// Decodificador do Boletim de Urna (arquivo .bu, ASN.1 DER) publicado pelo TSE.
// Estrutura: EntidadeEnvelopeGenerico { ..., conteudo OCTET STRING = EntidadeBoletimUrna }
// EntidadeBoletimUrna contém SEQUENCE OF ResultadoVotacaoPorEleicao {
//   idEleicao INTEGER, qtdEleitoresAptos INTEGER, ..., resultadosVotacao SEQUENCE OF ResultadoVotacao {
//     tipoCargo ENUMERATED, qtdComparecimento INTEGER, totaisVotosCargo SEQUENCE OF TotalVotosCargo {
//       [1] codigoCargo, ordemImpressao INTEGER, votosVotaveis SEQUENCE OF TotalVotosVotavel {
//         [1] tipoVoto, [2] quantidadeVotos, [3] identificacaoVotavel { partido, codigo }, ... } } } }
const BU = (() => {
  const TIPO = { NOMINAL: 1, BRANCO: 2, NULO: 3, LEGENDA: 4 };

  function tlv(b, p) {
    const tag = b[p];
    let q = p + 1;
    if ((tag & 0x1f) === 0x1f) { while (b[q] & 0x80) q++; q++; }
    let len = b[q++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + b[q++];
    }
    if (q + len > b.length) throw new Error('BU truncado');
    return { tag, cons: (tag & 0x20) !== 0, s: q, e: q + len };
  }

  function filhos(b, node) {
    const out = [];
    for (let p = node.s; p < node.e;) { const c = tlv(b, p); out.push(c); p = c.e; }
    return out;
  }

  function int(b, node) {
    let v = 0;
    for (let i = node.s; i < node.e; i++) v = v * 256 + b[i];
    return v;
  }

  function acharResultadoEleicao(b, node, ele, prof) {
    if (!node.cons || prof > 6) return null;
    const k = filhos(b, node);
    if (k.length >= 3 && k[0].tag === 0x02 && k[1].tag === 0x02 && int(b, k[0]) === ele && k.some(x => x.tag === 0x30)) {
      return { node, k };
    }
    for (const c of k) {
      const r = acharResultadoEleicao(b, c, ele, prof + 1);
      if (r) return r;
    }
    return null;
  }

  // Retorna { aptos, comp, votos: {numero: qtd}, brancos, nulos } para o cargo informado.
  function decodificar(buffer, idEleicao, cargo = 1) {
    const b = new Uint8Array(buffer);
    const raiz = tlv(b, 0);
    const conteudo = filhos(b, raiz).find(c => c.tag === 0x04);
    if (!conteudo) throw new Error('BU sem conteúdo');
    const ib = b.subarray(conteudo.s, conteudo.e);
    const r = acharResultadoEleicao(ib, tlv(ib, 0), Number(idEleicao), 0);
    if (!r) throw new Error('Eleição ' + idEleicao + ' não encontrada no BU');

    const res = { aptos: int(ib, r.k[1]), comp: 0, votos: {}, brancos: 0, nulos: 0 };
    const listaRV = r.k.filter(x => x.tag === 0x30).pop();
    for (const rv of filhos(ib, listaRV)) {
      const rk = filhos(ib, rv);
      const comp = int(ib, rk[1]);
      const listaCargos = rk.find(x => x.tag === 0x30);
      if (!listaCargos) continue;
      for (const tvc of filhos(ib, listaCargos)) {
        const tk = filhos(ib, tvc);
        const cn = tk[0];
        const codCargo = cn.cons ? int(ib, filhos(ib, cn)[0]) : int(ib, cn);
        if (codCargo !== cargo) continue;
        res.comp = comp;
        const listaVotos = tk.find(x => x.tag === 0x30);
        for (const vv of filhos(ib, listaVotos)) {
          const vk = filhos(ib, vv);
          const tipoN = vk.find(x => x.tag === 0x81);
          const qtdN = vk.find(x => x.tag === 0x82);
          if (!tipoN || !qtdN) continue;
          const tipo = int(ib, tipoN), qtd = int(ib, qtdN);
          const id = vk.find(x => x.tag === 0xa3);
          if (tipo === TIPO.NOMINAL || tipo === TIPO.LEGENDA) {
            const ids = id ? filhos(ib, id) : [];
            const num = ids.length ? int(ib, ids[ids.length > 1 ? 1 : 0]) : 0;
            res.votos[num] = (res.votos[num] || 0) + qtd;
          } else if (tipo === TIPO.BRANCO) res.brancos += qtd;
          else res.nulos += qtd;
        }
      }
    }
    return res;
  }

  return { decodificar };
})();

if (typeof module !== 'undefined') module.exports = BU;
