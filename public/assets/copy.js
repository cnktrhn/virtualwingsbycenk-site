/* E-posta "Kopyala" düğmesi: <button class="vw-copy" data-copy="…"> içinde [data-l] dil etiketleri */
(function(){
  var DONE={tr:"Kopyalandı ✓",en:"Copied ✓"};
  document.querySelectorAll(".vw-copy").forEach(function(b){
    b.addEventListener("click",function(){
      var v=b.dataset.copy,spans=b.querySelectorAll("[data-l]"),old=[].map.call(spans,function(s){return s.textContent});
      function done(){spans.forEach(function(s){s.textContent=DONE[s.dataset.l]||DONE.en});b.classList.add("ok");
        setTimeout(function(){spans.forEach(function(s,i){s.textContent=old[i]});b.classList.remove("ok")},2000)}
      function fb(){var t=document.createElement("textarea");t.value=v;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();
        try{document.execCommand("copy");done()}catch(e){}t.remove()}
      if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(v).then(done,fb);else fb();
    });
  });
})();
