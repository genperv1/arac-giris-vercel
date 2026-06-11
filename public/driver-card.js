// Sample behavior for the driver card
document.addEventListener('DOMContentLoaded', ()=>{
  const sample = {
    plate: '43 HP 433',
    trailer: '34 ZFP 78',
    contact: '0542 508 43 02',
    driver: 'ZÜLFÜ USLU',
    tc: '30234567840',
    timestamp: '14.11.2025 03:26:53'
  }

  // populate basic fields if present
  const plateEl = document.querySelector('.plate')
  if(plateEl) plateEl.textContent = sample.plate
  const left = document.querySelector('.left')
  if(left){
    left.querySelector('.value').textContent = sample.trailer
    const vals = left.querySelectorAll('.value')
    if(vals[1]) vals[1].textContent = sample.contact
  }
  const right = document.querySelector('.right')
  if(right){
    const vals = right.querySelectorAll('.value')
    if(vals[0]) vals[0].textContent = sample.driver
    const tcEl = document.getElementById('tc')
    if(tcEl) tcEl.textContent = maskTC(sample.tc)
  }
  const ts = document.querySelector('.timestamp')
  if(ts) ts.textContent = sample.timestamp

  // button behaviors
  const copyBtn = document.querySelector('.copy')
  if(copyBtn) copyBtn.addEventListener('click', ()=>{
    const text = `${sample.plate} - ${sample.driver} - ${sample.contact}`
    navigator.clipboard?.writeText(text).then(()=>{
      copyBtn.textContent = '✔️'
      setTimeout(()=>copyBtn.textContent='📋',800)
    })
  })

  const okBtn = document.getElementById('okBtn')
  if(okBtn) okBtn.addEventListener('click', ()=>{
    if(okBtn.classList.toggle('inactive')){
      okBtn.textContent = '⚠️ Sorun var'
      okBtn.style.background = 'rgba(245,158,11,0.12)'
      okBtn.style.color = '#f59e0b'
    } else {
      okBtn.textContent = '✅ Sorun yok'
      okBtn.style.background = 'rgba(16,185,129,0.12)'
      okBtn.style.color = '#10b981'
    }
  })

  const del = document.querySelector('.delete')
  if(del) del.addEventListener('click', ()=>{
    const card = document.querySelector('.card')
    card?.remove()
  })

  const edit = document.querySelector('.edit')
  if(edit) edit.addEventListener('click', ()=>{
    alert('Düzenleme isteği: Kart düzenleme işlevi eklenebilir.')
  })

  function maskTC(tc){
    if(!tc || tc.length<6) return tc
    return tc.slice(0,4) + '*****' + tc.slice(-2)
  }
})
