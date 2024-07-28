import React from 'react';
import './landing.css';
import $ from 'jquery';

//  Landing Page Content Fade Out
$(window).scroll(function(){
  $(".fadeoutLanding").css("opacity", 1 - $(window).scrollTop()/400);
});

const Landing = () => {
  return (
    <div className="name_sec fadeoutLanding">
        <div className="name_mainText">
            <li className="nameMainTextHollow">Hello There!</li>
            <li><div className="nameMainTextHollow">I'm</div> Aditya</li>
            <li>Sharma.</li>
        </div>
        <h2>Future Software and Web Developer</h2>
  </div>
  )
}

export default Landing