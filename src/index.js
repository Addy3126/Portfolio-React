import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import $ from 'jquery';
import SmoothScrolling from "./components/SmoothScrolling.tsx";

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <SmoothScrolling>
    <App />
    </SmoothScrolling>
  </React.StrictMode>
);

 //Nav Links
 document.querySelector('#about').addEventListener('click', function(){
  document.querySelector('.aboutSecHeading').scrollIntoView(true);
});

$(document).on('mousemove', function(e) {
  $('.cursorCustom').css({
    left: e.clientX,
    top: e.clientY,
  });
});

//  Landing Page Content Fade Out
$(window).scroll(function(){
  $(".fadeoutLanding").css("opacity", 1 - $(window).scrollTop()/400);
});

// About Section Heading - Horizontal Scroll => Direction: Left
let aSh = document.querySelector(".aboutSecHeading");
window.onscroll = () =>{
  let pos = window.scrollY;
  aSh.style.left = `-${pos}px`;
};

//Local Time
function localTimeUpdate(){
  let timePeriod = "PM";
  let date = new Date();
  let localHours = date.getUTCHours() + 5;
  let localMinutes = date.getUTCMinutes() + 30;
  if(localMinutes>59){
    localHours += 1;
    localMinutes -= 60;
    if(localMinutes<10){localMinutes = "0" + localMinutes}
  }
  if(localHours<12||localHours>23){
    timePeriod = "AM";
  }
  localHours = localHours%12;
  if(localHours === 0){localHours = 12}
  const shortLocalTime = `${localHours}:${localMinutes} ${timePeriod} GMT +5:30`;
  document.querySelector(".header_LocalTime").innerText = shortLocalTime;
}
setInterval(localTimeUpdate, 1000);
