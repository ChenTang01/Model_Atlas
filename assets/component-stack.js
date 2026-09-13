/* Compact component disclosures with one DOM order and two staggered lanes. */
(() => {
  'use strict';
  let stack=null,observer=null,frame=0;
  function layout(){
    if(!stack?.isConnected)return;
    const width=stack.clientWidth;if(!width)return;
    const rem=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    const gap=1.5*rem,columns=width>=52*rem+gap?2:1;
    const cardWidth=(width-gap*(columns-1))/columns;
    const bottoms=columns===2?[0,2*rem]:[0];
    stack.classList.add('is-stacked');stack.dataset.columns=String(columns);
    [...stack.children].forEach((card,index)=>{
      const lane=index%columns;
      card.style.width=cardWidth+'px';
      card.style.left=lane*(cardWidth+gap)+'px';
      card.style.top=bottoms[lane]+'px';
      bottoms[lane]+=card.getBoundingClientRect().height+gap;
    });
    stack.style.height=Math.max(0,...bottoms.map(y=>y-gap))+'px';
  }
  function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);}
  function mount(root){
    observer?.disconnect();cancelAnimationFrame(frame);
    stack=root.querySelector('.component-stack');if(!stack)return;
    stack.addEventListener('toggle',schedule,true);
    if(window.ResizeObserver){
      observer=new ResizeObserver(schedule);observer.observe(stack);
      [...stack.children].forEach(card=>observer.observe(card));
    }
    layout();schedule();
  }
  function reveal(element){
    if(!element)return;
    const card=element.closest('.component');
    const disclosure=card?.querySelector(':scope>.component-details');
    if(disclosure)disclosure.open=true;
    // A concept's conditions sit beside its heading/representation, not above it.
    const evidence=element.closest('.concept-binding')?.querySelector('.binding-evidence');
    if(evidence)evidence.open=true;
    for(let parent=element;parent;parent=parent.parentElement){
      if(parent.tagName==='DETAILS')parent.open=true;
    }
    layout();
  }
  window.addEventListener('resize',schedule);
  window.MiniAtlasStack={mount,layout,reveal};
})();
